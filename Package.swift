// swift-tools-version: 5.9
import PackageDescription

// SwiftPM only ever looks for a manifest at the ROOT of a repository, so a package added
// by Git URL — which is how anyone consuming a public repo will add it — has to be
// declared here rather than in ios/. The sources stay where they are; this manifest just
// points at them.
//
// ios/Package.swift is kept alongside it so the SDK can still be added as a LOCAL package
// (`.package(path: "../portal-sdk/ios")`) and opened on its own in Xcode. The two describe
// the same target; edit them together.
let package = Package(
    name: "AmthalPortal",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .library(name: "AmthalPortal", targets: ["AmthalPortal"])
    ],
    targets: [
        .target(
            name: "AmthalPortal",
            path: "ios/Sources/AmthalPortal",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
