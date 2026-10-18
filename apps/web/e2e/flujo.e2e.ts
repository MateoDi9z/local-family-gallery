// Flujo de punta a punta contra el backend real: asistente, subida, globo, visor y original intacto.

import { join } from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES = join(import.meta.dir, "../../../fixtures");
const FOTO = join(FIXTURES, "foto-gps.jpg");

test("asistente, subida, globo, visor y descarga del original", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "¡Bienvenidos!" })).toBeVisible();

  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("textbox", { name: "Nombre de la persona 1" }).fill("Persona 1");
  await page.getByRole("button", { name: "Siguiente" }).click();

  const canvas = page.getByTestId("map-picker").locator("canvas");
  await expect(canvas).toBeVisible();
  await canvas.click();
  await expect(page.getByText("Casa marcada.")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();

  await page.getByLabel("PIN", { exact: true }).fill("1234");
  await page.getByLabel("Repetí el PIN").fill("1234");
  await page.getByRole("button", { name: "Terminar" }).click();

  await page.getByRole("button", { name: "Persona 1" }).click();
  await page.locator("nav").getByRole("link", { name: "Subir" }).click();
  await page.getByTestId("file-input").setInputFiles(FOTO);
  // Al terminar, la app abre el resumen del lote (no se queda en la pantalla de subida).
  await expect(page.getByRole("heading", { name: "Resumen de la subida" })).toBeVisible();
  await expect(page.getByText("Todas tienen ubicación.")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Ver en el mapa" }).click();
  // El marcador sale del worker de MapLibre: si el worker no carga, el globo queda en blanco.
  await expect(page.locator(".place-marker").first()).toBeVisible();
  await page.getByTestId("place-chip").first().click();
  await page.getByTestId("tile").first().click();

  const href = await page.getByRole("link", { name: "Descargar original" }).getAttribute("href");
  expect(href).toBeTruthy();
  const res = await page.request.get(href ?? "");
  expect(res.ok()).toBeTruthy();
  const got = new Uint8Array(await res.body());
  const want = new Uint8Array(await Bun.file(FOTO).arrayBuffer());
  expect(got).toEqual(want);
});
