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

function Read-Host {
    param([string] $Prompt)
    $null = $global:PolarisAzureTestState.Prompts.Add($Prompt)
    if ($global:PolarisAzureTestState.Answers.Count -eq 0) { throw "Unexpected prompt: $Prompt" }
    return $global:PolarisAzureTestState.Answers.Dequeue()
}

function Write-Host {
    $null = $global:PolarisAzureTestState.Messages.Add(($args -join ' '))
    Microsoft.PowerShell.Utility\Write-Host @args
}

function docker { throw 'Setup must not build or deploy using local Docker.' }
function npm { throw 'Setup must not build the game locally.' }
function gh {
    $global:LASTEXITCODE = 0
    'TEST-GITHUB-TOKEN'
}

function az {
    $arguments = @($args)
    $state = $global:PolarisAzureTestState
    $null = $state.Commands.Add($arguments)
    $global:LASTEXITCODE = 0
    $key = $arguments[0..2] -join ' '
    if ($state.Scenario -eq 'failure' -and $key -eq 'containerapp github-action add') {
        $global:LASTEXITCODE = 1
        return
    }
    if ($state.Scenario -eq 'empty-json' -and $key -eq 'account show --subscription') { return }

    $registry = @{
        name = 'polarisregistrytest'; id = '/registry'; loginServer = 'polarisregistrytest.azurecr.io'
        roleAssignmentMode = if ($state.Scenario -eq 'abac') { 'AbacRepositoryPermissions' } else { 'LegacyRegistryPermissions' }
    }
    $app = @{
        id = '/app'; name = 'polaris'
        properties = @{
            provisioningState = 'Succeeded'; managedEnvironmentId = '/environment'
            configuration = @{ ingress = @{ fqdn = 'polaris.example.test' } }
        }
    }
    $hasExistingResources = $state.Scenario -in @(
        'existing', 'interactive-existing', 'interactive-new-with-existing', 'wrong-environment', 'modern-environment'
    ) -or ($state.ScriptName -eq 'setup-github-deployment.ps1' -and $state.Scenario -notin @('new-resources', 'interactive-new'))
    if ($state.Scenario -eq 'wrong-environment') { $app.properties.managedEnvironmentId = '/other-environment' }
    if ($state.Scenario -eq 'modern-environment') {
        $app.properties.Remove('managedEnvironmentId')
        $app.properties.environmentId = '/environment'
    }
    switch ($key) {
        'account list --only-show-errors' { '[{"id":"test-subscription","name":"Test subscription","state":"Enabled"}]'; return }
        'account show --subscription' { '{"id":"test-subscription","tenantId":"test-tenant"}'; return }
        'account show --only-show-errors' {
            if ($state.Scenario -eq 'wrong-tenant') { '{"id":"other-subscription","tenantId":"other-tenant"}' }
            else { '{"id":"test-subscription","tenantId":"test-tenant"}' }
            return
        }
        'group list --subscription' {
            if ($hasExistingResources) { '[{"id":"/group","name":"polaris-rg","location":"westeurope"}]' } else { '[]' }
            return
        }
        'group create --name' {
            @{ id = '/group'; name = (Get-Argument $arguments '--name'); location = (Get-Argument $arguments '--location') } | ConvertTo-Json
            return
        }
        'acr show --resource-group' { $registry | ConvertTo-Json -Compress; return }
        'acr list --resource-group' {
            if ($hasExistingResources) { ConvertTo-Json -InputObject @($registry) } else { '[]' }
            return
        }
        'acr create --resource-group' { $registry | ConvertTo-Json -Compress; return }
        'identity list --resource-group' {
            if ($hasExistingResources) { '[{"name":"polaris-pull","id":"/identity","principalId":"pull-principal"}]' } else { '[]' }
            return
        }
        'identity create --resource-group' { '{"name":"polaris-pull","id":"/identity","principalId":"pull-principal"}'; return }
        'monitor log-analytics workspace' {
            switch ($arguments[3]) {
                'list' {
                    if ($hasExistingResources -or $state.Scenario -in @('reuse-workspace', 'interactive-workspace')) {
                        '[{"id":"/workspace","name":"shared-logs","customerId":"workspace-id"}]'
                    } else { '[]' }
                }
                'create' {
                    @{ id = '/workspace'; name = (Get-Argument $arguments '--workspace-name'); customerId = 'workspace-id' } | ConvertTo-Json
                }
                'get-shared-keys' { '{"primarySharedKey":"TEST-WORKSPACE-SECRET"}' }
                default { throw 'Unexpected Log Analytics command.' }
            }
            return
        }
        'role assignment list' {
            if ($state.Scenario -eq 'existing') { '[{"id":"/role"}]' } else { '[]' }
            return
        }
        'containerapp env list' {
            if ($hasExistingResources) { '[{"name":"polaris-env","id":"/environment"}]' } else { '[]' }
            return
        }
        'containerapp env create' { '{"id":"/environment"}'; return }
        'containerapp list --resource-group' {
            if ($hasExistingResources) { ConvertTo-Json -InputObject @($app) -Depth 6 } else { '[]' }
            return
        }
        'containerapp create --resource-group' { $app | ConvertTo-Json -Depth 6; return }
        'containerapp show --resource-group' { $app | ConvertTo-Json -Depth 6; return }
        'ad sp list' {
            $name = if ($arguments -contains '--display-name') { Get-Argument $arguments '--display-name' } else { 'polarisregistrytest-polaris-github' }
            if ($state.Scenario -in @('existing', 'interactive-existing', 'interactive-new-with-existing', 'named-principal')) {
                @{ id = 'deployment-principal'; appId = 'client-id'; displayName = $name } | ConvertTo-Json
            } elseif ($state.Scenario -eq 'principal-prefix') {
                @{ id = 'unrelated-principal'; appId = 'other-client'; displayName = "$name-other" } | ConvertTo-Json
            } elseif ($state.Scenario -eq 'ambiguous-principal') {
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
            if ($state.Scenario -eq 'wrong-repository') {
                '{"properties":{"repoUrl":"https://github.com/other/repo","branch":"main"}}'
            } else {
                '{"properties":{"repoUrl":"https://github.com/aschauera/polaris-game","branch":"main"}}'
            }
            return
        }
    }
    Assert-True ((Get-Argument $arguments '--output') -eq 'none') "Unexpected Azure command: $key"
}

$script:messages = [System.Collections.Generic.List[string]]::new()
$global:PolarisAzureTestState = [pscustomobject]@{ Messages = $script:messages }
$parameters = @{ SubscriptionId = 'test-subscription'; RegistryName = 'polarisregistrytest'; NonInteractive = $true }
$count = 0
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'azure-common.ps1'), [ref] $tokens, [ref] $parseErrors
)
Assert-True ($parseErrors.Count -eq 0) 'azure-common.ps1 has syntax errors.'
foreach ($scriptName in @('setup-container-app.ps1', 'setup-github-deployment.ps1')) {
    $script:testScriptName = $scriptName
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    $tokens = $null
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref] $tokens, [ref] $parseErrors)
    Assert-True ($parseErrors.Count -eq 0) "$scriptName has syntax errors."
    $scenarios = if ($scriptName -eq 'setup-container-app.ps1') {
        @('what-if', 'new', 'existing', 'abac', 'empty-json', 'wrong-environment', 'modern-environment',
            'reuse-workspace', 'interactive-existing', 'interactive-new', 'interactive-new-with-existing',
            'interactive-workspace', 'invalid-selection', 'missing-noninteractive', 'missing-registry')
    } else {
        @('what-if', 'new', 'existing', 'abac', 'principal-prefix', 'ambiguous-principal', 'failure', 'empty-json',
            'wrong-repository', 'new-resources', 'interactive-existing', 'interactive-new', 'interactive-new-with-existing',
            'missing-noninteractive', 'missing-registry', 'named-principal', 'github-cli', 'wrong-tenant')
    }
    foreach ($scenario in $scenarios) {
        $script:scenario = $scenario
        $script:commands = [System.Collections.Generic.List[object]]::new()
        $script:messages = [System.Collections.Generic.List[string]]::new()
        $script:prompts = [System.Collections.Generic.List[string]]::new()
        $script:answers = [System.Collections.Generic.Queue[string]]::new()
        $global:PolarisAzureTestState = [pscustomobject]@{
            Commands = $script:commands; Scenario = $scenario; ScriptName = $scriptName
            Messages = $script:messages; Prompts = $script:prompts; Answers = $script:answers
        }
        $runParameters = $parameters.Clone()
        if ($scenario -in @('interactive-existing', 'interactive-new', 'interactive-new-with-existing', 'interactive-workspace', 'invalid-selection')) {
            $runParameters = @{}
            $responses = switch ($scenario) {
                'interactive-existing' { @('1', '1', '1', '1', '1', '1') }
                'interactive-new' {
                    if ($scriptName -eq 'setup-container-app.ps1') {
                        @('1', '0', '', '', '0', 'polarisregistrytest', '0', '', '0', '', '0', '', '0', '')
                    } else {
                        @('1', '0', '', '', '0', 'polarisregistrytest', '0', '', '0', '', '0', '', '0', '', '0', '')
                    }
                }
                'interactive-new-with-existing' {
                    if ($scriptName -eq 'setup-container-app.ps1') {
                        @('1', '1', '0', 'freshregistry', '0', 'fresh-env', '0', 'fresh-logs', '0', 'fresh-app', '0', 'fresh-pull')
                    } else {
                        @('1', '1', '1', '1', '0', 'fresh-deployer')
                    }
                }
                'invalid-selection' {
                    @('not-a-number', '9', '1', '0', '', '', '0', 'BAD!', 'polarisregistrytest', '0', '', '0', '', '0', '', '0', '')
                }
                'interactive-workspace' {
                    @('1', '0', '', '', '0', 'polarisregistrytest', '0', '', '1', '0', '', '0', '')
                }
            }
            if ($scenario -eq 'interactive-existing' -and $scriptName -eq 'setup-github-deployment.ps1') { $responses = @('1', '1', '1', '1', '1') }
            foreach ($answer in $responses) { $script:answers.Enqueue($answer) }
        }
        if ($scenario -eq 'reuse-workspace') { $runParameters.LogAnalyticsWorkspaceName = 'shared-logs' }
        if ($scenario -eq 'missing-noninteractive') { $runParameters = @{ RegistryName = 'polarisregistrytest'; NonInteractive = $true } }
        if ($scenario -eq 'missing-registry') { $runParameters = @{ SubscriptionId = 'test-subscription'; NonInteractive = $true } }
        if ($scenario -eq 'named-principal') { $runParameters.DeploymentPrincipalName = 'dedicated deploy principal' }
        if ($scenario -eq 'github-cli') { $runParameters.UseGitHubCli = $true }
        $failure = $null
        $result = $null
        try {
            $result = . $scriptPath @runParameters -WhatIf:($scenario -eq 'what-if')
        } catch {
            $failure = $_
        }
        if ($scenario -eq 'what-if') {
            Assert-True ($script:commands.Count -eq 0 -and $null -eq $failure) 'WhatIf invoked Azure or failed.'
        } elseif ($scenario -in @('ambiguous-principal', 'failure', 'empty-json', 'wrong-repository', 'wrong-environment', 'missing-noninteractive', 'missing-registry', 'wrong-tenant')) {
            Assert-True ($null -ne $failure -and $null -eq $result) "$scenario did not fail explicitly."
            Assert-True ($failure.Exception.Message -notmatch 'TEST-SECRET') 'Failure exposed a generated secret.'
            if ($scenario -in @('missing-noninteractive', 'missing-registry')) {
                Assert-True ($script:commands.Count -eq 0 -and $script:prompts.Count -eq 0) 'Missing automation parameters triggered Azure commands or prompts.'
            }
            if ($scenario -eq 'wrong-tenant') {
                Assert-True (@($script:commands | Where-Object { $_[0] -ne 'account' }).Count -eq 0) 'Tenant mismatch changed Azure resources or Entra principals.'
            }
        } else {
            if ($failure) { throw $failure }
            foreach ($command in $script:commands) {
                if ($command[0] -eq 'ad') {
                    Assert-True (-not ($command -contains '--subscription')) 'Tenant-scoped Entra command used an unsupported subscription argument.'
                } elseif (-not ($command[0] -eq 'account' -and ($command[1] -eq 'list' -or $command[2] -eq '--only-show-errors'))) {
                    Assert-True ((Get-Argument $command '--subscription') -eq 'test-subscription') 'Command targeted the wrong subscription.'
                }
                Assert-True (-not ($command[0] -eq 'acr' -and $command[1] -eq 'build')) 'Setup built an image locally or in ACR.'
            }
            Assert-True ($script:answers.Count -eq 0) "$scenario left resource selections unused."
            if ($scenario -like 'interactive-*') {
                $menuText = $script:messages -join "`n"
                foreach ($resourceType in @('resource group', 'container registry', 'Container App')) {
                    Assert-True ($menuText -match "Select ${resourceType}:") "Missing existing-resource list for $resourceType."
                }
                $expectedMenus = if ($scriptName -eq 'setup-container-app.ps1') {
                    if ($scenario -eq 'interactive-existing') { 5 } else { 6 }
                } else {
                    if ($scenario -eq 'interactive-new') { 7 } else { 4 }
                }
                Assert-True (@($script:messages | Where-Object { $_ -eq '  0) (new)' }).Count -eq $expectedMenus) 'A resource selection omitted its (new) option.'
            }
            if ($scriptName -eq 'setup-container-app.ps1') {
                Assert-True ($result.Url -eq 'https://polaris.example.test') 'Setup did not return the provisioned URL.'
                if ($scenario -in @('existing', 'interactive-existing', 'modern-environment')) {
                    Assert-True (@($script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -in @('create', 'update', 'ingress') }).Count -eq 0) 'Resource setup changed the existing image or ingress.'
                    Assert-True (@($script:commands | Where-Object {
                        ($_[0] -in @('acr', 'identity', 'group') -and $_[1] -eq 'create') -or
                        ($_[0] -eq 'containerapp' -and $_[1] -eq 'env' -and $_[2] -eq 'create') -or $_[0] -eq 'monitor'
                    }).Count -eq 0) 'Reusing resources unexpectedly created resources or changed environment logging.'
                } else {
                    $creation = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'create' }
                    Assert-True ((Get-Argument $creation '--target-port') -eq '80') 'Placeholder used the wrong port.'
                }
                if ($scenario -in @('reuse-workspace', 'interactive-workspace')) {
                    Assert-True (@($script:commands | Where-Object { $_[0] -eq 'monitor' -and $_[3] -eq 'create' }).Count -eq 0) 'Existing workspace was recreated.'
                }
                if ($scenario -in @('new', 'interactive-new', 'reuse-workspace', 'interactive-workspace', 'interactive-new-with-existing', 'invalid-selection')) {
                    $environmentCreation = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'env' -and $_[2] -eq 'create' }
                    Assert-True ((Get-Argument $environmentCreation '--logs-workspace-id') -eq 'workspace-id') 'Environment did not use the selected logging workspace.'
                }
                if ($scenario -eq 'interactive-new-with-existing') {
                    foreach ($expected in @(
                        @{ Prefix = 'acr create'; Flag = '--name'; Name = 'freshregistry' },
                        @{ Prefix = 'containerapp env create'; Flag = '--name'; Name = 'fresh-env' },
                        @{ Prefix = 'monitor log-analytics workspace create'; Flag = '--workspace-name'; Name = 'fresh-logs' },
                        @{ Prefix = 'containerapp create'; Flag = '--name'; Name = 'fresh-app' },
                        @{ Prefix = 'identity create'; Flag = '--name'; Name = 'fresh-pull' }
                    )) {
                        $creation = $script:commands | Where-Object { ($_ -join ' ').StartsWith("$($expected.Prefix) ") }
                        Assert-True ((Get-Argument $creation $expected.Flag) -eq $expected.Name) "The (new) choice did not create $($expected.Name)."
                    }
                }
            } else {
                Assert-True ($result.ActionsUrl -eq 'https://github.com/aschauera/polaris-game/actions') 'CD setup did not return its workflow URL.'
                $integration = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'github-action' -and $_[2] -eq 'add' }
                if ($scenario -eq 'github-cli') {
                    Assert-True ((Get-Argument $integration '--token') -eq 'TEST-GITHUB-TOKEN') 'CD setup did not use the authenticated GitHub CLI token.'
                    Assert-True (-not ($integration -contains '--login-with-github')) 'GitHub CLI authentication still prompted interactively.'
                    Assert-True (($script:messages -join "`n") -notmatch 'TEST-GITHUB-TOKEN') 'CD setup printed the GitHub token.'
                } else {
                    Assert-True ($integration -contains '--login-with-github') 'CD setup did not use interactive GitHub authentication.'
                }
                Assert-True ((Get-Argument $integration '--registry-username') -eq 'client-id') 'CD setup used registry admin credentials.'
                $ingress = $script:commands | Where-Object { $_[0] -eq 'containerapp' -and $_[1] -eq 'ingress' }
                Assert-True ((Get-Argument $ingress '--target-port') -eq '8080') 'CD setup did not configure the game port.'
                if ($scenario -in @('existing', 'interactive-existing', 'named-principal')) {
                    $rotation = $script:commands | Where-Object { $_[0] -eq 'ad' -and $_[2] -eq 'credential' }
                    Assert-True ($rotation -contains '--append') 'Credential rotation invalidated existing workflow secrets.'
                }
                if ($scenario -eq 'interactive-new-with-existing') {
                    $creation = $script:commands | Where-Object { $_[0] -eq 'ad' -and $_[2] -eq 'create-for-rbac' }
                    Assert-True ((Get-Argument $creation '--name') -eq 'fresh-deployer') 'The (new) choice reused an existing deployment principal.'
                }
                if ($scenario -eq 'principal-prefix') {
                    Assert-True (@($script:commands | Where-Object { $_[0] -eq 'ad' -and $_[2] -eq 'credential' }).Count -eq 0) 'A similarly named, unrelated principal was modified.'
                }
            }
            if ($scenario -eq 'abac') {
                $role = if ($scriptName -eq 'setup-container-app.ps1') { 'Container Registry Repository Reader' } else { 'Container Registry Repository Writer' }
                $assignment = @($script:commands | Where-Object { $_[0] -eq 'role' -and $_[2] -eq 'create' -and (Get-Argument $_ '--scope') -eq '/registry' })[-1]
                Assert-True ((Get-Argument $assignment '--role') -eq $role) 'ABAC registry received an unsupported role.'
            }
        }
        $count++
        Write-Host "PASS: $scriptName / $scenario"
    }
}
Write-Host "Passed $count Azure setup scenarios."
Remove-Variable PolarisAzureTestState -Scope Global
