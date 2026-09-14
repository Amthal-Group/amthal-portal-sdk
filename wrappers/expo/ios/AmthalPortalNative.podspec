require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# Absolute path to the native iOS SDK sources (single source of truth) living at
# portal-sdk/ios/Sources/AmthalPortal. They are COPIED into `Generated/` rather than
# symlinked, because CocoaPods drops globbed files whose realpath resolves outside
# the pod root.
#
# That path only exists in a monorepo CHECKOUT. Installed from the registry this
# package is unpacked on its own, three levels below nothing, so the copy has to have
# happened already: `npm run prepack` vendors the sources into `Generated/` before the
# tarball is built, and they ship inside it. Hence the existence check below — in a
# checkout we re-copy on every `pod install` so editing the SDK is picked up, and from
# a tarball we use what was vendored.
sdk_ios_sources = File.expand_path(File.join(__dir__, '..', '..', '..', 'ios', 'Sources', 'AmthalPortal'))
sdk_sources_available = File.directory?(sdk_ios_sources)

unless sdk_sources_available || File.directory?(File.join(__dir__, 'Generated'))
  raise "AmthalPortalNative: no Swift sources. Expected either #{sdk_ios_sources} " \
        "(monorepo checkout) or #{File.join(__dir__, 'Generated')} (published package). " \
        "In a checkout, run `npm run prepack -w @amthal-group/portal-expo` from the repo root."
end

Pod::Spec.new do |s|
  s.name           = 'AmthalPortalNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = 'https://github.com/Amthal-Group/amthal-portal-sdk'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Amthal-Group/amthal-portal-sdk' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Refresh the vendored copy from the single source of truth, but ONLY when that source
  # is actually present. From a published tarball there is nothing to copy and `Generated/`
  # is already populated, so wiping it here would delete the entire SDK.
  if sdk_sources_available
    s.prepare_command = <<-CMD
      set -e
      rm -rf Generated
      mkdir -p Generated
      cp -R "#{sdk_ios_sources}/." Generated/
    CMD
  end

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
