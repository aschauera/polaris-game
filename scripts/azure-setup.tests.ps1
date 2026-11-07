#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw $Message }
}

function Get-Argument {
    param([object[]] $Arguments, [string] $Name)
    $index = [Array]::IndexOf($Arguments, $Name)
    if ($index -lt 0) { throw "Missing command argument: $Name" }
    $Arguments[$index + 1]
}

function az {
    $arguments = @($args)
    $null = $script:commands.Add($arguments)
    $global:LASTEXITCODE = 0
    $key = $arguments[0..2] -join ' '
    if ($script:scenario -eq 'failure' -and $key -eq 'containerapp github-action add') {
        $global:LASTEXITCODE = 1
        return
    }
    if ($script:scenario -eq 'empty-json' -and $key -eq 'account show --subscription') { return }

    $registry = @{
        name = 'polarisregistrytest'; id = '/registry'; loginServer = 'polarisregistrytest.azurecr.io'
        roleAssignmentMode = if ($script:scenario -eq 'abac') { 'AbacRepositoryPermissions' } else { 'LegacyRegistryPermissions' }
    }
    $app = @{
        id = '/app'; name = 'polaris'
        properties = @{
            provisioningState = 'Succeeded'; managedEnvironmentId = '/environment'
            configuration = @{ ingress = @{ fqdn = 'polaris.example.test' } }
        }
    }
    switch ($key) {
        'account show --subscription' { '{"id":"test-subscription"}'; return }
        'group show --name' { '{"id":"/group"}'; return }
        'acr show --resource-group' { $registry | ConvertTo-Json -Compress; return }
        'acr list --resource-group' {
            if ($script:scenario -eq 'existing') { ConvertTo-Json -InputObject @($registry) } else { '[]' }
            return
        }
        'acr create --resource-group' { $registry | ConvertTo-Json -Compress; return }
        'identity create --resource-group' { '{"id":"/identity","principalId":"pull-principal"}'; return }
        'role assignment list' {
            if ($script:scenario -eq 'existing') { '[{"id":"/role"}]' } else { '[]' }
            return
        }
        'containerapp env list' {
            if ($script:scenario -eq 'existing') { '[{"name":"polaris-env","id":"/environment"}]' } else { '[]' }
            return
        }
        'containerapp env create' { '{"id":"/environment"}'; return }
        'containerapp list --resource-group' {
            if ($script:scenario -eq 'existing') { ConvertTo-Json -InputObject @($app) -Depth 6 } else { '[]' }
            return
        }
        'containerapp create --resource-group' { $app | ConvertTo-Json -Depth 6; return }
        'containerapp show --resource-group' { $app | ConvertTo-Json -Depth 6; return }
        'ad sp list' {
            $name = Get-Argument $arguments '--display-name'
            if ($script:scenario -eq 'existing') {
                @{ id = 'deployment-principal'; appId = 'client-id'; displayName = $name } | ConvertTo-Json
            } elseif ($script:scenario -eq 'principal-prefix') {
                @{ id = 'unrelated-principal'; appId = 'other-client'; displayName = "$name-other" } | ConvertTo-Json
            } elseif ($script:scenario -eq 'ambiguous-principal') {
                ConvertTo-Json -InputObject @(
                    @{ id = 'first'; appId = 'first-client'; displayName = $name },
                    @{ id = 'second'; appId = 'second-client'; displayName = $name }
                )
            } else {
                '[]'
            }
            return
        }
        'ad sp create-for-rbac' { '{"appId":"client-id","password":"TEST-SECRET","tenant":"tenant-id"}'; return }
        'ad sp credential' { '{"appId":"client-id","password":"TEST-SECRET","tenant":"tenant-id"}'; return }
        'ad sp show' { '{"id":"deployment-principal","appId":"client-id"}'; return }
        'containerapp github-action show' {
            if ($script:scenario -eq 'wrong-repository') {
                '{"properties":{"repoUrl":"https://github.com/other/repo","branch":"main"}}'
            } else {
                '{"properties":{"repoUrl":"https://github.com/aschauera/polaris-game","branch":"main"}}'
            }
            return
        }
    }
    Assert-True ((Get-Argument $arguments '--output') -eq 'none') "Unexpected Azure command: $key"
}

$parameters = @{ SubscriptionId = 'test-subscription'; RegistryName = 'polarisregistrytest' }
$count = 0
foreach ($scriptName in @('setup-container-app.ps1', 'setup-github-deployment.ps1')) {
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    $tokens = $null
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref] $tokens, [ref] $parseErrors)
    Assert-True ($parseErrors.Count -eq 0) "$scriptName has syntax errors."
    $scenarios = if ($scriptName -eq 'setup-container-app.ps1') {
        @('what-if', 'new', 'existing', 'abac', 'empty-json')
    } else {
        @('what-if', 'new', 'existing', 'abac', 'principal-prefix', 'ambiguous-principal', 'failure', 'empty-json', 'wrong-repository')
    }
    foreach ($scenario in $scenarios) {
        $script:scenario = $scenario
        $script:commands = [System.Collections.Generic.List[object]]::new()
        $failure = $null
        $result = $null
        try {
            $result = . $scriptPath @parameters -WhatIf:($scenario -eq 'what-if')
        } catch {
            $failure = $_
        }
        if ($scenario -eq 'what-if') {
            Assert-True ($script:commands.Count -eq 0 -and $null -eq $failure) 'WhatIf invoked Azure or failed.'
        } elseif ($scenario -in @('ambiguous-principal', 'failure', 'empty-json', 'wrong-repository')) {
            Assert-True ($null -ne $failure -and $null -eq $result) "$scenario did not fail explicitly."
            Assert-True ($failure.Exception.Message -notmatch 'TEST-SECRET') 'Failure exposed a generated secret.'
        } else {
            if ($failure) { throw $failure }
            foreach ($command in $script:commands) {
                Assert-True ((Get-Argument $command '--subscription') -eq 'test-subscription') 'Command targeted the wrong subscription.'
                Assert-True (-not ($command[0] -eq 'acr' -and $command[1] -eq 'build')) 'Setup built an image locally or in ACR.'
            }
            if ($scriptName -eq 'setup-container-app.ps1') {
                Assert-True ($result.Url -eq 'https://polaris.example.test') 'Setup did not return the provisioned URL.'
                if ($scenario -eq 'existing') {
                    Assert-True (@($script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -in @('create', 'update', 'ingress') }).Count -eq 0) 'Resource setup changed the existing image or ingress.'
                } else {
                    $creation = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'create' }
                    Assert-True ((Get-Argument $creation '--target-port') -eq '80') 'Placeholder used the wrong port.'
                }
            } else {
                Assert-True ($result.ActionsUrl -eq 'https://github.com/aschauera/polaris-game/actions') 'CD setup did not return its workflow URL.'
                $integration = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'github-action' -and $_[2] -eq 'add' }
                Assert-True ($integration -contains '--login-with-github') 'CD setup did not use interactive GitHub authentication.'
                Assert-True ((Get-Argument $integration '--registry-username') -eq 'client-id') 'CD setup used registry admin credentials.'
                $ingress = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'ingress' }
                Assert-True ((Get-Argument $ingress '--target-port') -eq '8080') 'CD setup did not configure the game port.'
                if ($scenario -eq 'existing') {
                    $rotation = $script:commands | Where-Object { $_[0] -eq 'ad' -and $_[2] -eq 'credential' }
                    Assert-True ($rotation -contains '--append') 'Credential rotation invalidated existing workflow secrets.'
                }
                if ($scenario -eq 'principal-prefix') {
                    Assert-True (@($script:commands | Where-Object { $_[0] -eq 'ad' -and $_[2] -eq 'credential' }).Count -eq 0) 'A similarly named, unrelated principal was modified.'
                }
            }
            if ($scenario -eq 'abac') {
                $role = if ($scriptName -eq 'setup-container-app.ps1') { 'Container Registry Repository Reader' } else { 'Container Registry Repository Writer' }
                $assignment = $script:commands | Where-Object { $_[0] -eq 'role' -and $_[2] -eq 'create' -and (Get-Argument $_ '--scope') -eq '/registry' }
                Assert-True ((Get-Argument $assignment '--role') -eq $role) 'ABAC registry received an unsupported role.'
            }
        }
        $count++
        Write-Host "PASS: $scriptName / $scenario"
    }
}
Write-Host "Passed $count Azure setup scenarios."
