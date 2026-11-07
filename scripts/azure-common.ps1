Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-Azure {
    param(
        [Parameter(Mandatory)]
        [string[]] $Arguments,

        [ValidateSet('json', 'none')]
        [string] $OutputMode = 'json'
    )

    $result = & az @Arguments --subscription $SubscriptionId --only-show-errors --output $OutputMode
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
