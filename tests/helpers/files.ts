/** Минимальные валидные файлы для тестов загрузки. */
export const PDF_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "latin1"),
  Buffer.from("1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1"),
]);

export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x00),
]);

/** ELF — то, что пытаются загрузить под видом квитанции. */
export const ELF_BYTES = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  Buffer.alloc(64, 0x41),
]);

export const HTML_BYTES = Buffer.from(
  "<html><script>alert(document.cookie)</script></html>",
  "utf8",
);
