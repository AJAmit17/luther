import ExpoModulesCore
import SwiftTerm
import UIKit

// A real terminal on the phone: SwiftTerm renders the raw byte stream from the
// Mac's pty and owns the keyboard (with its key bar: esc, ctrl, tab, arrows).
// JS carries bytes both ways; it never parses terminal output.
public class LutherTerminalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LutherTerminal")

    View(LutherTerminalView.self) {
      Events("onInput", "onResize")

      Prop("fontSize") { (view: LutherTerminalView, size: Double) in
        view.setFontSize(size)
      }
      Prop("dark") { (view: LutherTerminalView, dark: Bool) in
        view.setDark(dark)
      }

      AsyncFunction("feed") { (view: LutherTerminalView, b64: String) in
        view.feed(b64)
      }.runOnQueue(.main)
      AsyncFunction("focus") { (view: LutherTerminalView) in
        view.focus()
      }.runOnQueue(.main)
      AsyncFunction("blur") { (view: LutherTerminalView) in
        view.blur()
      }.runOnQueue(.main)
      AsyncFunction("reset") { (view: LutherTerminalView) in
        view.reset()
      }.runOnQueue(.main)
      AsyncFunction("size") { (view: LutherTerminalView) -> [String: Int] in
        view.size()
      }.runOnQueue(.main)
    }
  }
}

class LutherTerminalView: ExpoView, TerminalViewDelegate {
  private let term: TerminalView
  let onInput = EventDispatcher()
  let onResize = EventDispatcher()
  private var lastSize = (cols: 0, rows: 0)

  required init(appContext: AppContext? = nil) {
    term = TerminalView(frame: .zero, font: UIFont.monospacedSystemFont(ofSize: 12, weight: .regular))
    super.init(appContext: appContext)
    clipsToBounds = true
    term.terminalDelegate = self
    term.optionAsMetaKey = true
    addSubview(term)
    setDark(true)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    term.frame = bounds
    report()
  }

  func setFontSize(_ size: Double) {
    term.font = UIFont.monospacedSystemFont(ofSize: CGFloat(max(8, min(size, 24))), weight: .regular)
    report()
  }

  func setDark(_ dark: Bool) {
    // Luther's palette: graphite / paper, with the orange caret.
    term.nativeBackgroundColor = dark ? UIColor(red: 0.055, green: 0.059, blue: 0.067, alpha: 1) : UIColor(red: 0.965, green: 0.965, blue: 0.953, alpha: 1)
    term.nativeForegroundColor = dark ? UIColor(red: 0.953, green: 0.953, blue: 0.945, alpha: 1) : UIColor(red: 0.086, green: 0.090, blue: 0.102, alpha: 1)
    term.caretColor = dark ? UIColor(red: 1, green: 0.482, blue: 0.196, alpha: 1) : UIColor(red: 0.890, green: 0.353, blue: 0.071, alpha: 1)
    term.keyboardAppearance = dark ? .dark : .light
    backgroundColor = term.nativeBackgroundColor
  }

  func feed(_ b64: String) {
    guard let data = Data(base64Encoded: b64) else { return }
    term.feed(byteArray: ArraySlice([UInt8](data)))
  }

  func focus() { _ = term.becomeFirstResponder() }
  func blur() { _ = term.resignFirstResponder() }
  func reset() { term.getTerminal().resetToInitialState() }

  func size() -> [String: Int] {
    let t = term.getTerminal()
    return ["cols": t.cols, "rows": t.rows]
  }

  /// Tell JS the grid size when it changes (the server sizes the pty to it).
  private func report() {
    let t = term.getTerminal()
    if t.cols > 0, t.rows > 0, (t.cols, t.rows) != lastSize {
      lastSize = (t.cols, t.rows)
      onResize(["cols": t.cols, "rows": t.rows])
    }
  }

  // MARK: TerminalViewDelegate

  func send(source: TerminalView, data: ArraySlice<UInt8>) {
    onInput(["data": Data(data).base64EncodedString()])
  }

  func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
    if newCols > 0, newRows > 0, (newCols, newRows) != lastSize {
      lastSize = (newCols, newRows)
      onResize(["cols": newCols, "rows": newRows])
    }
  }

  func setTerminalTitle(source: TerminalView, title: String) {}
  func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
  func scrolled(source: TerminalView, position: Double) {}
  func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}

  /// Only web links open: terminal output is untrusted.
  func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
    if let url = URL(string: link), url.scheme == "https" || url.scheme == "http" {
      UIApplication.shared.open(url)
    }
  }
}
