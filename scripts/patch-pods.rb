#!/usr/bin/env ruby
# Patches Pods/Pods.xcodeproj/project.pbxproj after pod install.
#
# Two settings must be forced to NO across all build configurations in the
# generated Pods project. Both are re-set to YES by CocoaPods during its own
# project write (which runs after the Podfile post_install hook), so they
# cannot be reliably persisted by the hook alone.
#
# Settings patched:
#   ENABLE_MODULE_VERIFIER = NO
#     CocoaPods re-enforces YES for DEFINES_MODULE targets. The modules-verifier
#     binary (invoked during Pods target builds) treats double-quoted framework
#     header includes as fatal errors regardless of CLANG_WARN_QUOTED. Disabling
#     the verifier entirely is the correct fix for CapacitorCordova 7.x headers.
#
#   CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = NO
#     Set to NO at target level by the Podfile post_install hook, but the
#     project-level Debug/Release configurations retain YES. Patching here
#     ensures NO at every level, covering both target and project-wide configs.
#
# Run via: ruby scripts/patch-pods.rb
# Called automatically by: npm run cap:sync:ios, npm run ios:fix-pods,
#                          npm run ios:prep-archive, npm run ios:verify-pods

SETTINGS = [
  'ENABLE_MODULE_VERIFIER',
  'CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER',
].freeze

VERIFY_ONLY_FLAG = '--verify-only'
verify_only = ARGV.delete(VERIFY_ONLY_FLAG)

unless ARGV.empty?
  warn "[patch-pods] ERROR: unknown argument(s): #{ARGV.join(' ')}"
  warn "[patch-pods] Supported flag: #{VERIFY_ONLY_FLAG}"
  exit 1
end

pbxproj = File.join(__dir__, '..', 'ios', 'App', 'Pods', 'Pods.xcodeproj', 'project.pbxproj')

unless File.exist?(pbxproj)
  warn "[patch-pods] ERROR: #{pbxproj} not found."
  warn "[patch-pods] Run 'npm run cap:sync:ios' or 'cd ios/App && pod install' first."
  exit 1
end

original = File.read(pbxproj)
patched  = original.dup

def setting_regex(name, value)
  /^(\s*#{Regexp.escape(name)}\s*=\s*)#{value}(;)/
end

def count_setting(text, name, value)
  text.scan(setting_regex(name, value)).length
end

def find_setting_lines(text, name, value)
  regex = setting_regex(name, value)
  text.each_line.with_index(1).filter_map do |line, line_number|
    "#{line_number}:#{line.strip}" if line.match?(regex)
  end
end

stats = SETTINGS.to_h do |name|
  [name, {
    yes_before: count_setting(patched, name, 'YES'),
    no_before: count_setting(patched, name, 'NO'),
  }]
end

unless verify_only
  SETTINGS.each do |name|
    patched.gsub!(setting_regex(name, 'YES')) { "#{Regexp.last_match(1)}NO#{Regexp.last_match(2)}" }
  end
end

stats.each do |name, info|
  info[:yes_after] = count_setting(patched, name, 'YES')
  info[:no_after] = count_setting(patched, name, 'NO')
  info[:changed] = info[:yes_before] - info[:yes_after]
end

# --- Write only if changed ---
if !verify_only && patched != original
  File.write(pbxproj, patched)
elsif verify_only
  puts '[patch-pods] Verify-only mode: no changes written.'
else
  puts '[patch-pods] Patch mode: no file changes were needed.'
end

stats.each do |name, info|
  puts "[patch-pods] #{name}: changed=#{info[:changed]}, confirmed_no=#{info[:no_after]}, remaining_yes=#{info[:yes_after]}"
end

# --- Verify: fail loudly if any YES remain ---
remaining_yes = stats.values.sum { |info| info[:yes_after] }

if remaining_yes > 0
  warn "[patch-pods] ERROR: #{remaining_yes} YES setting(s) remain in #{pbxproj}:"
  SETTINGS.each do |name|
    lines = find_setting_lines(patched, name, 'YES')
    next if lines.empty?
    warn "[patch-pods]   #{name} still YES on:"
    lines.each do |line|
      warn "[patch-pods]     #{line}"
    end
  end
  warn '[patch-pods] The Pods project may be in an unexpected format. Check manually.'
  exit 1
else
  puts '[patch-pods] Verification passed: no YES instances remain for either setting.'
end
