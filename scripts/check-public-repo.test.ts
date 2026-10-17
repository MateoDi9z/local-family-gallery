import { expect, test } from "bun:test";
import { findViolations, MAX_FIXTURE_BYTES, missingDockerignore } from "./check-public-repo";

const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

test("bloquea medios fuera de fixtures/ y archivos privados", () => {
  const v = findViolations(
    [
      { path: "apps/web/foto.HEIC", bytes: bytes("x") },
      { path: "docs/video.mov", bytes: bytes("x") },
      { path: ".env", bytes: bytes("A=1") },
      { path: "deploy/.env.production", bytes: bytes("A=1") },
      { path: "fixtures-reales/a.txt", bytes: bytes("x") },
      { path: "data/gallery.sqlite", bytes: bytes("x") },
    ],
    {},
    [],
  );
  expect(v).toHaveLength(6);
});

test("deja pasar código, .env.example y fixtures del manifiesto", () => {
  const v = findViolations(
    [
      { path: "apps/server/src/app.ts", bytes: bytes("export {}") },
      { path: "deploy/.env.example", bytes: bytes("DOMAIN=") },
      { path: "fixtures/a.jpg", bytes: bytes("img") },
      { path: "fixtures/manifest.json", bytes: bytes("{}") },
    ],
    { "fixtures/a.jpg": sha("img") },
    [],
  );
  expect(v).toEqual([]);
});

test("fixtures: fuera del manifiesto, con hash distinto o de más de 2 MB", () => {
  const big = new Uint8Array(MAX_FIXTURE_BYTES + 1);
  const v = findViolations(
    [
      { path: "fixtures/nuevo.jpg", bytes: bytes("x") },
      { path: "fixtures/cambiado.jpg", bytes: bytes("otro") },
      { path: "fixtures/grande.mp4", bytes: big },
    ],
    { "fixtures/cambiado.jpg": sha("original"), "fixtures/grande.mp4": sha("") },
    [],
  );
  expect(v).toHaveLength(4); // grande.mp4 falla por tamaño y por hash
});

test("lista privada: detecta sin importar mayúsculas y no imprime el término", () => {
  const v = findViolations([{ path: "README.md", bytes: bytes("vivo en Calle Falsa 123") }], {}, [
    "calle falsa 123",
    "",
  ]);
  expect(v).toHaveLength(1);
  expect(v[0]).not.toContain("falsa");
});

test(".dockerignore tiene que cubrir el .gitignore", () => {
  expect(missingDockerignore("# c\n.env\nnode_modules/\n", ".git\n.env\n")).toEqual(["node_modules/"]);
});
