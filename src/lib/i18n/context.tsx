"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { en } from "./dictionaries/en";
import { vi } from "./dictionaries/vi";
import { es } from "./dictionaries/es";
import { zh } from "./dictionaries/zh";
import { fr } from "./dictionaries/fr";
import { ja } from "./dictionaries/ja";

type Language = "en" | "vi" | "es" | "zh" | "fr" | "ja";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, defaultValue?: string) => string;
}

const dictionaries: Record<Language, any> = {
  en,
  vi,
  es,
  zh,
  fr,
  ja,
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LANGUAGE_STORAGE_KEY = "gemradar_language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    try {
      const storedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language;
      if (storedLang && dictionaries[storedLang]) {
        setLanguageState(storedLang);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch (e) {
      // Ignore
    }
  };

  const t = (path: string, defaultValue?: string): string => {
    const keys = path.split(".");

    // Try current language first
    let current: any = dictionaries[language];
    let found = true;
    for (const key of keys) {
      if (current == null || current[key] === undefined) {
        found = false;
        break;
      }
      current = current[key];
    }
    if (found && typeof current === "string") return current;

    // Fall back to English if current language is missing the key
    if (language !== "en") {
      let enCurrent: any = dictionaries["en"];
      let enFound = true;
      for (const key of keys) {
        if (enCurrent == null || enCurrent[key] === undefined) {
          enFound = false;
          break;
        }
        enCurrent = enCurrent[key];
      }
      if (enFound && typeof enCurrent === "string") return enCurrent;
    }

    // Final fallback: caller-supplied default or the key path
    if (defaultValue !== undefined) return defaultValue;
    return path;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    // Fallback if used outside provider
    return {
      language: "en" as Language,
      setLanguage: () => {},
      t: (key: string, defaultValue?: string) => defaultValue || key,
    };
  }
  return context;
}
