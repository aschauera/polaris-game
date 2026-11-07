#Requires -Version 7.0
<#
.SYNOPSIS
Configure Azure Container Apps' built-in GitHub continuous deployment.
.DESCRIPTION
Azure CLI generates the workflow in GitHub and configures its secrets. GitHub
authentication is interactive. No image is built by this local script.
Requires rights to manage Entra applications, Azure role assignments and the
GitHub repository's workflows/secrets. Reconfiguration appends an expiring
credential to the dedicated deployment principal without invalidating old ones.
.EXAMPLE
.\scripts\setup-github-deployment.ps1 -SubscriptionId '<subscription-id>' -RegistryName 'polarisuniqueregistry' -WhatIf
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

    [ValidatePattern('^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string] $RepositoryUrl = 'https://github.com/aschauera/polaris-game',

    [ValidateNotNullOrEmpty()]
    [string] $Branch = 'main'
)

if (-not $PSCmdlet.ShouldProcess(
    "$RepositoryUrl ($Branch) -> $SubscriptionId / $ResourceGroup / $AppName",
    'Configure Azure-generated GitHub workflow, repository secrets and deployment permissions'
)) {
    return
}
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Install Azure CLI and run az login before configuring continuous deployment.'
}
. (Join-Path $PSScriptRoot 'azure-common.ps1')

$null = Invoke-Azure -Arguments @('account', 'show')
$registry = Invoke-Azure -Arguments @('acr', 'show', '--resource-group', $ResourceGroup, '--name', $RegistryName)
$group = Invoke-Azure -Arguments @('group', 'show', '--name', $ResourceGroup)
$app = Invoke-Azure -Arguments @('containerapp', 'show', '--resource-group', $ResourceGroup, '--name', $AppName)
if ($app.properties.provisioningState -ne 'Succeeded') {
    throw 'Run setup-container-app.ps1 successfully before configuring continuous deployment.'
}

$principalName = "$RegistryName-$AppName-github"
$principals = @(Invoke-Azure -Arguments @('ad', 'sp', 'list', '--display-name', $principalName) | Where-Object displayName -EQ $principalName)
if ($principals.Count -gt 1) {
    throw "Multiple deployment principals named $principalName exist. Resolve the ambiguity before rerunning."
}
$credentials = $null
try {
    if ($principals.Count -eq 1) {
        $principal = $principals[0]
        $credentials = Invoke-Azure -Arguments @('ad', 'sp', 'credential', 'reset', '--id', $principal.appId, '--append')
    } else {
        $credentials = Invoke-Azure -Arguments @('ad', 'sp', 'create-for-rbac', '--name', $principalName, '--skip-assignment')
        $principal = Invoke-Azure -Arguments @('ad', 'sp', 'show', '--id', $credentials.appId)
    }
    Ensure-AzureRole -PrincipalId $principal.id -Role 'Contributor' -Scope $app.id
    Ensure-AzureRole -PrincipalId $principal.id -Role 'Reader' -Scope $group.id
    Ensure-AzureRole -PrincipalId $principal.id -Role (Get-RegistryRole $registry -Push) -Scope $registry.id

    Write-Host 'Authenticate with GitHub when prompted. Azure CLI will create the workflow and configure its secrets.'
    Invoke-Azure -Arguments @(
        'containerapp', 'github-action', 'add', '--resource-group', $ResourceGroup, '--name', $AppName,
        '--repo-url', $RepositoryUrl, '--branch', $Branch, '--context-path', './',
        '--image', $AppName, '--registry-url', $registry.loginServer,
        '--registry-username', $credentials.appId, '--registry-password', $credentials.password,
        '--service-principal-client-id', $credentials.appId, '--service-principal-client-secret', $credentials.password,
        '--service-principal-tenant-id', $credentials.tenant, '--login-with-github'
    ) -OutputMode none
} finally {
    $credentials = $null
}

Invoke-Azure -Arguments @(
    'containerapp', 'ingress', 'enable', '--resource-group', $ResourceGroup, '--name', $AppName,
    '--type', 'external', '--target-port', '8080', '--transport', 'http', '--allow-insecure', 'false'
) -OutputMode none
$configuration = Invoke-Azure -Arguments @(
    'containerapp', 'github-action', 'show', '--resource-group', $ResourceGroup, '--name', $AppName
)
if ($configuration.properties.repoUrl.TrimEnd('/') -ne $RepositoryUrl -or $configuration.properties.branch -ne $Branch) {
    throw 'Azure did not report the requested GitHub repository and branch configuration.'
}

[pscustomobject]@{
    Repository = $RepositoryUrl
    Branch = $Branch
    ActionsUrl = "$RepositoryUrl/actions"
    AppName = $AppName
    DeploymentPrincipal = $principal.appId
}
