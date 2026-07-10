require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# Absolute path to the native iOS SDK sources (single source of truth) living at
# portal-sdk/ios/Sources/AmthalPortal. They are COPIED into `Generated/` at
# `pod install` time (see prepare_command) rather than symlinked, because
# CocoaPods drops globbed files whose realpath resolves outside the pod root.
sdk_ios_sources = File.expand_path(File.join(__dir__, '..', '..', '..', 'ios', 'Sources', 'AmthalPortal'))

Pod::Spec.new do |s|
  s.name           = 'AmthalPortalNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = 'https://github.com/amthal-group/portal-sdk'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/amthal-group/portal-sdk' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Copy the SDK sources into the pod so CocoaPods will actually include them.
  # Runs on every `pod install` — re-run pod install after editing the SDK.
  s.prepare_command = <<-CMD
    set -e
    rm -rf Generated
    mkdir -p Generated
    cp -R "#{sdk_ios_sources}/." Generated/
  CMD

  # The Expo glue (*.swift at ios/ root, incl. BundleModuleShim.swift) compiles
  # together with the copied SDK sources into ONE Swift module — so the glue gets
  # `internal` access to the SDK, and the shim provides the `Bundle.module`
  # accessor the SDK's Localization.swift expects under SPM.
  s.source_files = ['*.swift', 'Generated/**/*.swift']

  # The SDK's localized interstitial strings, shipped as a resource bundle the
  # Bundle.module shim resolves at runtime.
  s.resource_bundles = {
    'AmthalPortalResources' => ['Generated/Resources/*.lproj']
  }
end
