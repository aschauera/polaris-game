#Requires -Version 7.0
<#
.SYNOPSIS
Configure Azure Container Apps' built-in GitHub continuous deployment.
.DESCRIPTION
Azure CLI generates the workflow in GitHub and configures its secrets. GitHub
authentication is interactive. No image is built by this local script.
Omitted resource names list existing resources with a (new) option. New app or
registry selections invoke resource setup before configuring GitHub deployment.
Requires rights to manage Entra applications, Azure role assignments and the
GitHub repository's workflows/secrets. Reconfiguration appends an expiring
credential to the dedicated deployment principal without invalidating old ones.
.EXAMPLE
.\scripts\setup-github-deployment.ps1 -SubscriptionId '<subscription-id>' -RegistryName 'polarisuniqueregistry' -WhatIf
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

    [ValidateNotNullOrEmpty()]
    [string] $DeploymentPrincipalName,

    [switch] $NonInteractive,

    [switch] $UseGitHubCli,

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

if ($NonInteractive -and -not $RegistryName) { throw 'Supply -RegistryName for -NonInteractive.' }
$SubscriptionId = Select-AzureSubscription -Id $SubscriptionId -NonInteractive:$NonInteractive
$null = Invoke-Azure -Arguments @('account', 'show')
$group = Resolve-AzureResourceGroup -Name $ResourceGroup -NonInteractive:$NonInteractive
$ResourceGroup = $group.name
$registrySelection = Select-AzureResource -ResourceType 'container registry' -Name $RegistryName `
    -NamePattern '^[a-z0-9]{5,50}$' -NonInteractive:$NonInteractive `
    -Resources @(Invoke-Azure -Arguments @('acr', 'list', '--resource-group', $ResourceGroup))
$RegistryName = $registrySelection.Name
$registry = $registrySelection.Resource
$appSelection = Select-AzureResource -ResourceType 'Container App' -Name $AppName -DefaultName 'polaris' `
    -NamePattern '^(?=.{2,31}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' -NonInteractive:$NonInteractive `
    -Resources @(Invoke-Azure -Arguments @('containerapp', 'list', '--resource-group', $ResourceGroup))
$AppName = $appSelection.Name
$app = $appSelection.Resource
if (-not $registry -or -not $app) {
    $setupParameters = @{
        SubscriptionId = $SubscriptionId; ResourceGroup = $ResourceGroup
        RegistryName = $RegistryName; AppName = $AppName; Location = $group.location
        NonInteractive = $NonInteractive; Confirm = $false
    }
    if ($app) { $setupParameters.EnvironmentName = ((Get-ContainerAppEnvironmentId $app) -split '/')[-1] }
    $null = & (Join-Path $PSScriptRoot 'setup-container-app.ps1') @setupParameters
    $registry = Invoke-Azure -Arguments @('acr', 'show', '--resource-group', $ResourceGroup, '--name', $RegistryName)
    $app = Invoke-Azure -Arguments @('containerapp', 'show', '--resource-group', $ResourceGroup, '--name', $AppName)
}
if ($app.properties.provisioningState -ne 'Succeeded') {
    throw 'Run setup-container-app.ps1 successfully before configuring continuous deployment.'
}

$principalName = $DeploymentPrincipalName
if (-not $principalName -and $NonInteractive) { $principalName = "$RegistryName-$AppName-github" }
$principalArguments = @('ad', 'sp', 'list')
if ($principalName) {
    $principalArguments += @('--display-name', $principalName)
} else {
    $principalArguments += @('--all', '--filter', "servicePrincipalType eq 'Application'")
}
$principals = @(Invoke-Azure -Arguments $principalArguments | ForEach-Object {
    [pscustomobject]@{ name = $_.displayName; id = $_.id; appId = $_.appId }
})
$principalSelection = Select-AzureResource -ResourceType 'GitHub deployment principal' -Name $principalName `
    -DefaultName "$RegistryName-$AppName-github" -NamePattern '^[^\r\n]+$' -Resources $principals -NonInteractive:$NonInteractive
$principalName = $principalSelection.Name
$credentials = $null
$githubToken = $null
try {
    if ($principalSelection.Resource) {
        $principal = $principalSelection.Resource
        $credentials = Invoke-Azure -Arguments @('ad', 'sp', 'credential', 'reset', '--id', $principal.appId, '--append')
    } else {
        $credentials = Invoke-Azure -Arguments @('ad', 'sp', 'create-for-rbac', '--name', $principalName, '--skip-assignment')
        $principal = Invoke-Azure -Arguments @('ad', 'sp', 'show', '--id', $credentials.appId)
    }
    Ensure-AzureRole -PrincipalId $principal.id -Role 'Contributor' -Scope $app.id
    Ensure-AzureRole -PrincipalId $principal.id -Role 'Reader' -Scope $group.id
    Ensure-AzureRole -PrincipalId $principal.id -Role (Get-RegistryRole $registry -Push) -Scope $registry.id

    $githubAuthentication = @('--login-with-github')
    if ($UseGitHubCli) {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Install and authenticate GitHub CLI before using -UseGitHubCli.' }
        $githubToken = & gh auth token --hostname github.com
        if ($LASTEXITCODE -ne 0 -or -not $githubToken) { throw 'GitHub CLI could not retrieve an authenticated token.' }
        $githubAuthentication = @('--token', ($githubToken -join "`n").Trim())
        Write-Host 'Using the authenticated GitHub CLI account to configure the workflow and secrets.'
    } else {
        Write-Host 'Authenticate with GitHub when prompted. Azure CLI will create the workflow and configure its secrets.'
    }
    Invoke-Azure -Arguments (@(
        'containerapp', 'github-action', 'add', '--resource-group', $ResourceGroup, '--name', $AppName,
        '--repo-url', $RepositoryUrl, '--branch', $Branch, '--context-path', './',
        '--image', $AppName, '--registry-url', $registry.loginServer,
        '--registry-username', $credentials.appId, '--registry-password', $credentials.password,
        '--service-principal-client-id', $credentials.appId, '--service-principal-client-secret', $credentials.password,
        '--service-principal-tenant-id', $credentials.tenant
    ) + $githubAuthentication) -OutputMode none
} finally {
    $credentials = $null
    $githubToken = $null
    $githubAuthentication = $null
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
