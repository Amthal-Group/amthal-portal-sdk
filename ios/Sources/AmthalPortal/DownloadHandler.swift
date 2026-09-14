import UIKit
import QuickLook
import UniformTypeIdentifiers

/// Handles `downloadRequest` bridge messages: downloads the file with the
/// payload's headers attached (never logging their values), moves it to a
/// temporary location with a proper filename/extension, and presents a
/// QuickLook preview. The owning view controller retains this object so the
/// QLPreviewController data source stays alive while the preview is visible.
@MainActor
final class DownloadHandler: NSObject {
    private weak var presenter: UIViewController?
    private var currentItemURL: URL?
    private var activeTask: URLSessionDownloadTask?

    func handle(
        _ payload: DownloadRequestPayload,
        config: PortalConfig,
        presenter: UIViewController
    ) {
        guard let url = URL(string: payload.url),
              let scheme = url.scheme?.lowercased()
        else { return }
        // HTTPS only (http tolerated for localhost — or any host when the
        // DEV-only allowInsecureHTTP escape hatch is active).
        guard scheme == "https"
                || (scheme == "http"
                    && (PortalConfig.isLocalhost(url.host ?? "") || config.allowInsecureHTTP))
        else { return }

        self.presenter = presenter

        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        // Sensitive headers (e.g. Authorization) are only ever attached to
        // allowlisted origins so credentials cannot leak to third parties.
        if let headers = payload.headers, config.isOriginAllowed(url) {
            for (field, value) in headers {
                request.setValue(value, forHTTPHeaderField: field)
            }
        }

        let filename = Self.resolveFilename(payload: payload, url: url)

        activeTask?.cancel()
        let task = URLSession.shared.downloadTask(with: request) { [weak self] tempURL, response, error in
            guard error == nil,
                  let tempURL,
                  let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode)
            else { return }

            // The temp file only survives the completion handler, so the move
            // must happen synchronously here (background queue).
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("AmthalPortalDownloads", isDirectory: true)
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent(filename)
            try? FileManager.default.removeItem(at: destination)
            do {
                try FileManager.default.moveItem(at: tempURL, to: destination)
            } catch {
                return
            }

            Task { @MainActor [weak self] in
                self?.presentPreview(for: destination)
            }
        }
        activeTask = task
        task.resume()
    }

    private func presentPreview(for fileURL: URL) {
        guard let presenter, presenter.view.window != nil else { return }
        currentItemURL = fileURL
        let preview = QLPreviewController()
        preview.dataSource = self
        presenter.present(preview, animated: true)
    }

    static func resolveFilename(payload: DownloadRequestPayload, url: URL) -> String {
        var name = payload.filename?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Strip any path components / traversal.
        name = name.components(separatedBy: "/").last ?? name
        name = name.replacingOccurrences(of: "\\", with: "_")
        if name.isEmpty || name == "." || name == ".." {
            name = url.lastPathComponent
        }
        if name.isEmpty || name == "/" || name == "." {
            name = "download"
        }
        if (name as NSString).pathExtension.isEmpty,
           let mime = payload.mime,
           let ext = UTType(mimeType: mime)?.preferredFilenameExtension {
            name += ".\(ext)"
        }
        return name
    }
}

// MARK: - QLPreviewControllerDataSource

extension DownloadHandler: QLPreviewControllerDataSource {
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        currentItemURL == nil ? 0 : 1
    }

    func previewController(
        _ controller: QLPreviewController,
        previewItemAt index: Int
    ) -> QLPreviewItem {
        (currentItemURL ?? URL(fileURLWithPath: "")) as NSURL
    }
}
