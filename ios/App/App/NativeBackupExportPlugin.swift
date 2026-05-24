import Capacitor
import Foundation
import UIKit

@objc(NativeBackupExportPlugin)
public class NativeBackupExportPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "NativeBackupExportPlugin"
    public let jsName = "NativeBackupExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "exportBackup", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCallID: String?
    private var pendingTempDirectoryURL: URL?

    @objc func exportBackup(_ call: CAPPluginCall) {
        guard pendingCallID == nil else {
            call.reject("A backup export is already in progress.", "EXPORT_IN_PROGRESS")
            return
        }

        let filename = call.getString("filename")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let safeFilename = URL(fileURLWithPath: filename).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !safeFilename.isEmpty, safeFilename.lowercased().hasSuffix(".json") else {
            call.reject("Backup export requires a filename ending in .json.", "INVALID_FILENAME")
            return
        }

        guard let json = call.getString("json") else {
            call.reject("Backup export requires JSON content.", "INVALID_JSON")
            return
        }

        let tempDirectoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("NativeBackupExport-\(UUID().uuidString)", isDirectory: true)
        let tempFileURL = tempDirectoryURL.appendingPathComponent(safeFilename, isDirectory: false)

        do {
            try FileManager.default.createDirectory(at: tempDirectoryURL, withIntermediateDirectories: true)
            try json.write(to: tempFileURL, atomically: true, encoding: .utf8)
        } catch {
            cleanupTempExport(at: tempDirectoryURL)
            call.reject("Failed to stage the backup file for export.", "EXPORT_WRITE_FAILED", error)
            return
        }

        call.keepAlive = true
        bridge?.saveCall(call)
        pendingCallID = call.callbackId
        pendingTempDirectoryURL = tempDirectoryURL

        DispatchQueue.main.async { [weak self] in
            self?.presentDocumentPicker(for: tempFileURL)
        }
    }

    private func presentDocumentPicker(for fileURL: URL) {
        guard let bridge, let viewController = bridge.viewController else {
            finishPendingFailure(
                message: "Unable to open the native document exporter.",
                code: "EXPORT_PRESENTATION_UNAVAILABLE"
            )
            return
        }

        let picker = UIDocumentPickerViewController(
            forExporting: [fileURL],
            asCopy: true
        )
        picker.delegate = self
        if #available(iOS 15.0, *) {
            picker.shouldShowFileExtensions = true
        }

        topPresenter(from: viewController).present(picker, animated: true)
    }

    private func topPresenter(from root: UIViewController) -> UIViewController {
        var presenter = root
        while let next = presenter.presentedViewController {
            presenter = next
        }
        return presenter
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishPendingSuccess(status: "saved")
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishPendingSuccess(status: "cancelled")
    }

    private func finishPendingSuccess(status: String) {
        guard let call = currentPendingCall() else {
            cleanupPendingExport()
            return
        }

        call.resolve([
            "status": status
        ])
        bridge?.releaseCall(call)
        cleanupPendingExport()
    }

    private func finishPendingFailure(message: String, code: String, error: Error? = nil) {
        guard let call = currentPendingCall() else {
            cleanupPendingExport()
            return
        }

        call.reject(message, code, error)
        bridge?.releaseCall(call)
        cleanupPendingExport()
    }

    private func currentPendingCall() -> CAPPluginCall? {
        guard let pendingCallID else { return nil }
        return bridge?.savedCall(withID: pendingCallID)
    }

    private func cleanupPendingExport() {
        if let tempDirectoryURL = pendingTempDirectoryURL {
            cleanupTempExport(at: tempDirectoryURL)
        }
        pendingTempDirectoryURL = nil
        pendingCallID = nil
    }

    private func cleanupTempExport(at directoryURL: URL) {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}
