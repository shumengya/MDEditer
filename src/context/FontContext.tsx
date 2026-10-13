import { createContext, useContext, useState, useLayoutEffect, ReactNode } from "react";

/** null 表示用内置字体 */
export interface FontSettings {
  cjk: string | null;
  latin: string | null;
}

interface FontContextValue {
  fonts: FontSettings;
  setFonts: (fonts: FontSettings) => void;
}

export const BUILTIN_CJK = "LXGW WenKai Mono";
export const BUILTIN_LATIN = "Maple Mono";

const STORAGE_KEY = "mdeditor-fonts";
const DEFAULT_FONTS: FontSettings = { cjk: null, latin: null };

const quote = (family: string) => `"${family.replace(/["\\]/g, "")}"`;

/**
 * 西文字体放最前：浏览器逐字回退，西文字体里没有的汉字才轮到中文字体。
 * 代价是若选了自带汉字的字体做西文字体，中文也会用它显示。
 * 内置文楷和系统楷体始终垫底，保证所选字体缺字时不至于掉到宋体
 */
export function buildFontStack({ cjk, latin }: FontSettings): string {
  const families = [latin ?? BUILTIN_LATIN, cjk ?? BUILTIN_CJK, BUILTIN_CJK, "KaiTi", "STKaiti"];
  const unique = families.filter((family, index) => families.indexOf(family) === index);
  return [...unique.map(quote), "monospace"].join(", ");
}

function loadFonts(): FontSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      cjk: typeof saved?.cjk === "string" ? saved.cjk : null,
      latin: typeof saved?.latin === "string" ? saved.latin : null,
    };
  } catch {
    return DEFAULT_FONTS;
  }
}

const FontContext = createContext<FontContextValue>({ fonts: DEFAULT_FONTS, setFonts: () => {} });

export function FontProvider({ children }: { children: ReactNode }) {
  const [fonts, setFonts] = useState<FontSettings>(loadFonts);

  // 写在 <html> 的内联样式上，优先级高于 font-vars.css 里的默认值；
  // 用 layout effect 是为了首帧就生效，不闪一下默认字体
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--font-ui", buildFontStack(fonts));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fonts));
  }, [fonts]);

  return <FontContext.Provider value={{ fonts, setFonts }}>{children}</FontContext.Provider>;
}

export const useFonts = () => useContext(FontContext);
