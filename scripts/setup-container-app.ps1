#Requires -Version 7.0
<#
.SYNOPSIS
Provision the Azure resources used by Polaris GitHub continuous deployment.
.DESCRIPTION
Creates or reuses a registry, environment, pull identity and Container App.
Omitted resource names prompt with existing resources and a (new) option.
The initial public image is a placeholder, not the game. Does not build images.
.EXAMPLE
.\scripts\setup-container-app.ps1 -SubscriptionId '<subscription-id>' -RegistryName 'polarisuniqueregistry' -WhatIf
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [ValidateNotNullOrEmpty()]
    [string] $SubscriptionId,

    [ValidatePattern('^[a-z0-9]{5,50}$')]
    [string] $RegistryName,

    [ValidatePattern('^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')]
    [ValidateLength(2, 31)]
    [string] $AppName,

    [ValidateNotNullOrEmpty()]
    [string] $ResourceGroup,

    [ValidatePattern('^[a-z0-9]+$')]
    [string] $Location,

    [ValidateNotNullOrEmpty()]
    [string] $EnvironmentName,

    [ValidateNotNullOrEmpty()]
    [string] $PullIdentityName,

    [ValidateNotNullOrEmpty()]
    [string] $LogAnalyticsWorkspaceName,

    [switch] $NonInteractive
)

if (-not $PSCmdlet.ShouldProcess("$SubscriptionId / $ResourceGroup / $AppName", 'Set up Azure Container Apps resources (no game build)')) {
    return
}
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Install Azure CLI and run az login before running setup.'
}
. (Join-Path $PSScriptRoot 'azure-common.ps1')

if ($NonInteractive -and -not $RegistryName) { throw 'Supply -RegistryName for -NonInteractive.' }
$SubscriptionId = Select-AzureSubscription -Id $SubscriptionId -NonInteractive:$NonInteractive
$null = Invoke-Azure -Arguments @('account', 'show')
$group = Resolve-AzureResourceGroup -Name $ResourceGroup -Location $Location -NonInteractive:$NonInteractive
$ResourceGroup = $group.name
if (-not $Location) { $Location = $group.location }
foreach ($provider in @('Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.ContainerRegistry', 'Microsoft.ManagedIdentity')) {
    Invoke-Azure -Arguments @('provider', 'register', '--namespace', $provider, '--wait') -OutputMode none
}

$registrySelection = Select-AzureResource -ResourceType 'container registry' -Name $RegistryName `
    -NamePattern '^[a-z0-9]{5,50}$' -NonInteractive:$NonInteractive `
    -Resources @(Invoke-Azure -Arguments @('acr', 'list', '--resource-group', $ResourceGroup))
$RegistryName = $registrySelection.Name
$registry = $registrySelection.Resource
if (-not $registry) {
    $registry = Invoke-Azure -Arguments @(
        'acr', 'create', '--resource-group', $ResourceGroup, '--name', $RegistryName,
        '--location', $Location, '--sku', 'Basic', '--admin-enabled', 'false'
    )
}
Invoke-Azure -Arguments @('acr', 'config', 'authentication-as-arm', 'update', '--registry', $RegistryName, '--status', 'enabled') -OutputMode none

$environmentSelection = Select-AzureResource -ResourceType 'Container Apps environment' -Name $EnvironmentName `
    -DefaultName "$(if ($AppName) { $AppName } else { 'polaris' })-env" -NonInteractive:$NonInteractive `
    -NamePattern '^[a-zA-Z0-9-]{2,60}$' `
    -Resources @(Invoke-Azure -Arguments @('containerapp', 'env', 'list', '--resource-group', $ResourceGroup))
$EnvironmentName = $environmentSelection.Name
$environment = $environmentSelection.Resource
if (-not $environment) {
    $workspaceSelection = Select-AzureResource -ResourceType 'Log Analytics workspace' -Name $LogAnalyticsWorkspaceName `
        -DefaultName "$EnvironmentName-logs" -NamePattern '^[a-zA-Z0-9][a-zA-Z0-9-]{2,62}$' -NonInteractive:$NonInteractive `
        -Resources @(Invoke-Azure -Arguments @('monitor', 'log-analytics', 'workspace', 'list', '--resource-group', $ResourceGroup))
    $workspace = $workspaceSelection.Resource
    if (-not $workspace) {
        $workspace = Invoke-Azure -Arguments @(
            'monitor', 'log-analytics', 'workspace', 'create', '--resource-group', $ResourceGroup,
            '--workspace-name', $workspaceSelection.Name, '--location', $Location
        )
    }
    $workspaceKeys = $null
    try {
        $workspaceKeys = Invoke-Azure -Arguments @(
            'monitor', 'log-analytics', 'workspace', 'get-shared-keys',
            '--resource-group', $ResourceGroup, '--workspace-name', $workspace.name
        )
        $environment = Invoke-Azure -Arguments @(
            'containerapp', 'env', 'create', '--resource-group', $ResourceGroup, '--name', $EnvironmentName,
            '--location', $Location, '--logs-destination', 'log-analytics',
            '--logs-workspace-id', $workspace.customerId, '--logs-workspace-key', $workspaceKeys.primarySharedKey
        )
    } finally {
        $workspaceKeys = $null
    }
}
$appSelection = Select-AzureResource -ResourceType 'Container App' -Name $AppName -DefaultName 'polaris' `
    -NamePattern '^(?=.{2,31}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' -NonInteractive:$NonInteractive `
    -Resources @(Invoke-Azure -Arguments @('containerapp', 'list', '--resource-group', $ResourceGroup))
$AppName = $appSelection.Name
$app = $appSelection.Resource
if ($app -and (Get-ContainerAppEnvironmentId $app) -ne $environment.id) {
    throw "Existing app $AppName belongs to a different environment. Use a different AppName."
}
$identitySelection = Select-AzureResource -ResourceType 'pull managed identity' -Name $PullIdentityName `
    -DefaultName "$AppName-pull" -NamePattern '^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$' -NonInteractive:$NonInteractive `
    -Resources @(Invoke-Azure -Arguments @('identity', 'list', '--resource-group', $ResourceGroup))
$identity = $identitySelection.Resource
if (-not $identity) {
    $identity = Invoke-Azure -Arguments @(
        'identity', 'create', '--resource-group', $ResourceGroup, '--name', $identitySelection.Name, '--location', $Location
    )
}
Ensure-AzureRole -PrincipalId $identity.principalId -Role (Get-RegistryRole $registry) -Scope $registry.id
if ($app) {
    Invoke-Azure -Arguments @(
        'containerapp', 'identity', 'assign', '--resource-group', $ResourceGroup, '--name', $AppName,
        '--user-assigned', $identity.id
    ) -OutputMode none
} else {
    $app = Invoke-Azure -Arguments @(
        'containerapp', 'create', '--resource-group', $ResourceGroup, '--name', $AppName,
        '--environment', $environment.id, '--image', 'mcr.microsoft.com/k8se/quickstart:latest',
        '--user-assigned', $identity.id, '--ingress', 'external', '--target-port', '80', '--transport', 'http',
        '--allow-insecure', 'false', '--revisions-mode', 'single',
        '--cpu', '0.25', '--memory', '0.5Gi', '--min-replicas', '0', '--max-replicas', '1'
    )
}
Invoke-Azure -Arguments @(
    'containerapp', 'registry', 'set', '--resource-group', $ResourceGroup, '--name', $AppName,
    '--server', $registry.loginServer, '--identity', $identity.id
) -OutputMode none
if ($app.properties.provisioningState -ne 'Succeeded' -or -not $app.properties.configuration.ingress.fqdn) {
    throw 'Container App setup did not succeed or returned no ingress hostname.'
}

[pscustomobject]@{
    Url = "https://$($app.properties.configuration.ingress.fqdn)"
    Registry = $registry.loginServer
    ResourceGroup = $ResourceGroup
    AppName = $AppName
    RegistryName = $RegistryName
    EnvironmentName = $EnvironmentName
    PullIdentityName = $identitySelection.Name
}
