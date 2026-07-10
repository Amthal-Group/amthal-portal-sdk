// swift-tools-version: 5.9
import PackageDescription

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
            path: "Sources/AmthalPortal",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
