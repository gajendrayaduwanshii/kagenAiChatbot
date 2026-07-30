export type LanguageStyle =
  "English" | "Hindi (Devanagari)" | "Hinglish (Roman script)";

const romanHindiMarkers = new Set([
  "aap",
  "aapka",
  "aapke",
  "aapki",
  "aur",
  "batao",
  "bataye",
  "batayen",
  "chahiye",
  "chaiye",
  "dikhao",
  "hai",
  "hain",
  "ho",
  "ka",
  "kaise",
  "kare",
  "karein",
  "ke",
  "ki",
  "kya",
  "main",
  "madad",
  "mein",
  "meri",
  "mujhe",
  "nahi",
  "namaste",
  "namaskar",
  "par",
  "se",
]);

export function detectLanguageStyle(message: string): LanguageStyle {
  if (/[\u0900-\u097f]/.test(message)) return "Hindi (Devanagari)";
  const words = message.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((word) => romanHindiMarkers.has(word))
    ? "Hinglish (Roman script)"
    : "English";
}
