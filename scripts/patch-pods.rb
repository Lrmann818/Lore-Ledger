#!/usr/bin/env ruby
# Patches Pods/Pods.xcodeproj/project.pbxproj after pod install.
#
# CocoaPods re-enforces ENABLE_MODULE_VERIFIER = YES for DEFINES_MODULE targets
# during its own project write, which runs after the Podfile post_install hook.
# This script runs after pod install is fully done and applies the setting that
# the post_install hook cannot reliably persist.
#
# Run via: ruby scripts/patch-pods.rb
# Called automatically by npm cap:sync:ios and ios:fix-pods scripts.

pbxproj = File.join(__dir__, '..', 'ios', 'App', 'Pods', 'Pods.xcodeproj', 'project.pbxproj')

unless File.exist?(pbxproj)
  warn "[patch-pods] #{pbxproj} not found — run pod install first"
  exit 1
end

original = File.read(pbxproj)
patched  = original.gsub('ENABLE_MODULE_VERIFIER = YES;', 'ENABLE_MODULE_VERIFIER = NO;')

if patched == original
  puts '[patch-pods] ENABLE_MODULE_VERIFIER already NO — no changes needed'
else
  File.write(pbxproj, patched)
  count = original.scan('ENABLE_MODULE_VERIFIER = YES;').length
  puts "[patch-pods] Set ENABLE_MODULE_VERIFIER = NO (#{count} instance#{count == 1 ? '' : 's'} patched)"
end
