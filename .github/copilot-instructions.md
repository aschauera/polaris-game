# Copilot instructions

## Azure deployment

Deploy Polaris as an **Azure Container App**, not a static website or App Service.
Local setup provisions or reuses Azure resources; the Container App is configured
for built-in GitHub continuous deployment. Azure generates the GitHub Actions
workflow and secrets; GitHub builds the root Dockerfile and deploys subsequent
pushes. Do not replace this with local image builds or a hand-authored deployment
workflow.

Keep both Azure setup scripts interactive by default: list existing resources
at each resource-selection step and include a **(new)** option. Preserve explicit
parameters, `-NonInteractive`, and side-effect-free `-WhatIf` for automation.
Subscriptions are an existing-account prerequisite, not resources these scripts
create. See [deployment documentation](../README.md#docker-and-azure-container-apps)
and run `pwsh -File .\scripts\azure-setup.tests.ps1` after script changes.

## Authoritative visual and world reference

For all visual and world changes, treat `docs/showcase.png` as the authoritative root reference from which to derive visual world design and layout. Inspect it before planning or implementing changes. Derive terrain forms, spatial composition, scale, palette, and world presentation from this reference; other images, mockups, and visual briefs are supplementary and must not override it.

Do not replace or regenerate `docs/showcase.png` merely to match a new implementation. Changing the authoritative reference or intentionally departing from it requires explicit user approval.

## Visual review delivery

Whenever visual changes are requested, implement them first, then capture fresh screenshots or other suitable visuals from the updated, running application for human inspection. Deliver these in a separate **Visual overview**, distinct from the implementation summary, with directly viewable visuals or links. Show the actual implemented result, not the reference image, a mockup, or stale screenshots. If fresh visuals cannot be captured, explicitly state the limitation and its cause.
