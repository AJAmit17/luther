Pod::Spec.new do |s|
  s.name           = 'LutherTerminal'
  s.version        = '1.0.0'
  s.summary        = "Luther's native terminal view: SwiftTerm fed a remote byte stream"
  s.homepage       = 'https://github.com/AJAmit17/luther'
  s.license        = 'UNLICENSED'
  s.author         = 'Luther'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
  # SwiftTerm (MIT, https://github.com/migueldeicaza/SwiftTerm), as a Swift package.
  spm_dependency(s,
    url: 'https://github.com/migueldeicaza/SwiftTerm.git',
    requirement: { kind: 'exactVersion', version: '1.20.0' },
    products: ['SwiftTerm'])
end
