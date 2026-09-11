const [offer, company] = process.argv.slice(2);
if (!offer || !company) throw new Error("offer y company son obligatorios");

const { guardarOferta } = await import("../../build/database.js");
await guardarOferta({
  oferta: offer,
  sourcePlatform: "cross-process-test",
  company,
  estado: "nueva",
});
