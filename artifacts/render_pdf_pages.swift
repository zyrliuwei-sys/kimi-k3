import AppKit
import Foundation
import PDFKit

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  fatalError("Usage: render_pdf_pages <input.pdf> <output-dir>")
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

guard let document = PDFDocument(url: inputURL) else {
  fatalError("Could not open PDF")
}

let scale: CGFloat = 2
for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
  let image = NSImage(size: size)
  image.lockFocus()
  guard let context = NSGraphicsContext.current?.cgContext else {
    fatalError("Could not create graphics context")
  }
  NSColor.white.setFill()
  context.fill(CGRect(origin: .zero, size: size))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  image.unlockFocus()

  guard let tiffData = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiffData),
        let pngData = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode PNG")
  }
  let destination = outputURL.appendingPathComponent("page-\(index + 1).png")
  try pngData.write(to: destination)
}

print("Rendered \(document.pageCount) page(s).")
