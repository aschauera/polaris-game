#Requires -Version 7.0
<#
.SYNOPSIS
Provision the Azure resources used by Polaris GitHub continuous deployment.
.DESCRIPTION
Creates or reuses a registry, environment, pull identity and Container App.
The initial public image is a placeholder, not the game. Does not build images.
.EXAMPLE
.\scripts\setup-container-app.ps1 -SubscriptionId '<subscription-id>' -RegistryName 'polarisuniqueregistry' -WhatIf
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $SubscriptionId,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9]{5,50}$')]
    [string] $RegistryName,

    [ValidatePattern('^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')]
    [ValidateLength(2, 31)]
    [string] $AppName = 'polaris',

    [ValidateNotNullOrEmpty()]
    [string] $ResourceGroup = 'polaris-rg',

    [ValidatePattern('^[a-z0-9]+$')]
    [string] $Location = 'westeurope'
)

if (-not $PSCmdlet.ShouldProcess("$SubscriptionId / $ResourceGroup / $AppName", 'Set up Azure Container Apps resources (no game build)')) {
    return
}
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Install Azure CLI and run az login before running setup.'
}
. (Join-Path $PSScriptRoot 'azure-common.ps1')

$null = Invoke-Azure -Arguments @('account', 'show')
foreach ($provider in @('Microsoft.App', 'Microsoft.OperationalInsights', 'Microsoft.ContainerRegistry', 'Microsoft.ManagedIdentity')) {
    Invoke-Azure -Arguments @('provider', 'register', '--namespace', $provider, '--wait') -OutputMode none
}
Invoke-Azure -Arguments @('group', 'create', '--name', $ResourceGroup, '--location', $Location) -OutputMode none

$registry = @(Invoke-Azure -Arguments @('acr', 'list', '--resource-group', $ResourceGroup)) | Where-Object name -EQ $RegistryName
if (-not $registry) {
    $registry = Invoke-Azure -Arguments @(
        'acr', 'create', '--resource-group', $ResourceGroup, '--name', $RegistryName,
        '--location', $Location, '--sku', 'Basic', '--admin-enabled', 'false'
    )
}
Invoke-Azure -Arguments @('acr', 'config', 'authentication-as-arm', 'update', '--registry', $RegistryName, '--status', 'enabled') -OutputMode none
$identity = Invoke-Azure -Arguments @(
    'identity', 'create', '--resource-group', $ResourceGroup, '--name', "$AppName-pull", '--location', $Location
)
Ensure-AzureRole -PrincipalId $identity.principalId -Role (Get-RegistryRole $registry) -Scope $registry.id

$environmentName = "$AppName-env"
$environment = @(Invoke-Azure -Arguments @('containerapp', 'env', 'list', '--resource-group', $ResourceGroup)) | Where-Object name -EQ $environmentName
if (-not $environment) {
    $environment = Invoke-Azure -Arguments @(
        'containerapp', 'env', 'create', '--resource-group', $ResourceGroup, '--name', $environmentName,
        '--location', $Location, '--logs-destination', 'log-analytics'
    )
}
$app = @(Invoke-Azure -Arguments @('containerapp', 'list', '--resource-group', $ResourceGroup)) | Where-Object name -EQ $AppName
if ($app) {
    if ($app.properties.managedEnvironmentId -ne $environment.id) {
        throw "Existing app $AppName belongs to a different environment. Use a different AppName."
    }
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
}
