Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Select-AzureResource {
    param(
        [string] $ResourceType,
        [object[]] $Resources = @(),
        [string] $Name,
        [string] $DefaultName,
        [string] $NamePattern = '^[a-zA-Z0-9_.()-]+(?<!\.)$',
        [switch] $NonInteractive,
        [switch] $ExistingOnly
    )

    if (-not $Name -and $NonInteractive) {
        $Name = $DefaultName
        if (-not $Name) { throw "Supply a $ResourceType name for -NonInteractive." }
    }
    if ($Name) {
        if ($Name -notmatch $NamePattern) { throw "Invalid $ResourceType name: $Name" }
        $matches = @($Resources | Where-Object name -EQ $Name)
        if ($matches.Count -gt 1) { throw "Multiple $ResourceType resources named $Name exist. Resolve the ambiguity before rerunning." }
        if ($ExistingOnly -and $matches.Count -eq 0) { throw "$ResourceType $Name does not exist." }
        return [pscustomobject]@{ Name = $Name; Resource = if ($matches.Count) { $matches[0] } else { $null } }
    }

    Write-Host "`nSelect ${ResourceType}:"
    for ($index = 0; $index -lt $Resources.Count; $index++) {
        $resource = $Resources[$index]
        Write-Host "  $($index + 1)) $($resource.name) [$($resource.id)]"
    }
    if (-not $ExistingOnly) { Write-Host '  0) (new)' }
    if ($ExistingOnly -and $Resources.Count -eq 0) { throw "No existing $ResourceType resources are available." }
    while ($true) {
        $answer = Read-Host 'Selection'
        $choice = 0
        if ([int]::TryParse($answer, [ref] $choice)) {
            if ($choice -ge 1 -and $choice -le $Resources.Count) {
                return [pscustomobject]@{ Name = $Resources[$choice - 1].name; Resource = $Resources[$choice - 1] }
            }
            if ($choice -eq 0 -and -not $ExistingOnly) {
                while ($true) {
                    $newName = Read-Host "New $ResourceType name [$DefaultName]"
                    if (-not $newName) { $newName = $DefaultName }
                    if ($newName -and $newName -match $NamePattern -and -not ($Resources | Where-Object name -EQ $newName)) {
                        return [pscustomobject]@{ Name = $newName; Resource = $null }
                    }
                    Write-Host 'Enter a valid, nonempty name that is not already listed.'
                }
            }
        }
        Write-Host 'Enter one of the listed selection numbers.'
    }
}

function Select-AzureSubscription {
    param([string] $Id, [switch] $NonInteractive)
    if ($Id) { return $Id }
    if ($NonInteractive) { throw 'Supply -SubscriptionId for -NonInteractive.' }
    $result = & az account list --only-show-errors --output json
    if ($LASTEXITCODE -ne 0 -or -not $result) { throw 'Cannot list Azure subscriptions. Run az login before setup.' }
    $subscriptions = @($result -join "`n" | ConvertFrom-Json -ErrorAction Stop | Where-Object state -EQ 'Enabled')
    $selection = Select-AzureResource -ResourceType 'subscription (existing account required)' -Resources $subscriptions -ExistingOnly
    return $selection.Resource.id
}

function Resolve-AzureResourceGroup {
    param([string] $Name, [string] $Location, [switch] $NonInteractive)
    $selection = Select-AzureResource -ResourceType 'resource group' -Name $Name -DefaultName 'polaris-rg' `
        -Resources @(Invoke-Azure -Arguments @('group', 'list')) -NonInteractive:$NonInteractive
    if ($selection.Resource) { return $selection.Resource }
    if (-not $Location) {
        $Location = if ($NonInteractive) { 'westeurope' } else { Read-Host 'New resource group region [westeurope]' }
        if (-not $Location) { $Location = 'westeurope' }
    }
    if ($Location -notmatch '^[a-z0-9]+$') { throw "Invalid Azure region: $Location" }
    return Invoke-Azure -Arguments @('group', 'create', '--name', $selection.Name, '--location', $Location)
}

function Get-ContainerAppEnvironmentId {
    param([object] $App)
    foreach ($property in @('environmentId', 'managedEnvironmentId')) {
        $value = $App.properties.PSObject.Properties[$property]
        if ($value -and $value.Value) { return $value.Value }
    }
    throw "Container App $($App.name) did not report its environment."
}

function Invoke-Azure {
    param(
        [Parameter(Mandatory)]
        [string[]] $Arguments,

        [ValidateSet('json', 'none')]
        [string] $OutputMode = 'json',

        [switch] $UseDefaultAccount
    )

    $subscriptionArguments = @()
    if (-not $UseDefaultAccount -and $Arguments[0] -ne 'ad') {
        $subscriptionArguments = @('--subscription', $SubscriptionId)
    }
    $result = & az @Arguments @subscriptionArguments --only-show-errors --output $OutputMode
    if ($LASTEXITCODE -ne 0) {
        # Only show the command name: arguments may contain generated credentials.
        throw "Azure CLI failed (exit $LASTEXITCODE): az $($Arguments[0..1] -join ' '). Setup stopped."
    }
    if ($OutputMode -eq 'json') {
        if (-not $result) {
            throw "Azure CLI returned no JSON: az $($Arguments[0..1] -join ' ')"
        }
        $result -join "`n" | ConvertFrom-Json -ErrorAction Stop
    } elseif ($result) {
        $result | ForEach-Object { Write-Host $_ }
    }
}

function Ensure-AzureRole {
    param([string] $PrincipalId, [string] $Role, [string] $Scope)

    $assignments = @(Invoke-Azure -Arguments @(
        'role', 'assignment', 'list', '--scope', $Scope,
        '--query', "[?principalId=='$PrincipalId' && roleDefinitionName=='$Role']"
    ))
    if ($assignments.Count -eq 0) {
        Invoke-Azure -Arguments @(
            'role', 'assignment', 'create', '--assignee-object-id', $PrincipalId,
            '--assignee-principal-type', 'ServicePrincipal', '--role', $Role, '--scope', $Scope
        ) -OutputMode none
    }
}

function Get-RegistryRole {
    param([object] $Registry, [switch] $Push)
    $mode = $Registry.PSObject.Properties['roleAssignmentMode']
    if ($mode -and $mode.Value -eq 'AbacRepositoryPermissions') {
        if ($Push) { return 'Container Registry Repository Writer' }
        return 'Container Registry Repository Reader'
    }
    if ($Push) { return 'AcrPush' }
    return 'AcrPull'
}
