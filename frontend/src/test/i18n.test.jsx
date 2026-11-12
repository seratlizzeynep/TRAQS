import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import LanguageSwitch from "../components/LanguageSwitch.jsx";
import en from "../locales/en.js";
import tr from "../locales/tr.js";
import { I18nProvider, detectLanguage, useI18n } from "../i18n.jsx";
import Login from "../pages/Login.jsx";
import { AuthProvider } from "../auth.jsx";

describe("dictionaries", () => {
  it("Turkish has exactly the keys English has", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });
  it("no empty translations", () => {
    for (const d of [en, tr]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe("");
  });
  it("Turkish texts are really translated", () => {
    expect(tr["login.submit"]).not.toBe(en["login.submit"]);
    expect(tr["projects.title"]).toBe("Projeler");
  });
});

function Probe() {
  const { t, lang } = useI18n();
  return <p data-testid="p">{lang}:{t("projects.title")}:{t("does.not.exist")}</p>;
}

describe("language selection", () => {
  it("defaults to English and falls back to the key for unknown texts", () => {
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("p")).toHaveTextContent("en:Projects:does.not.exist");
  });

  it("uses a Turkish browser language by default", () => {
    Object.defineProperty(navigator, "language", { value: "tr-TR", configurable: true });
    expect(detectLanguage()).toBe("tr");
  });

  it("falls back to English for unsupported browser languages", () => {
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    expect(detectLanguage()).toBe("en");
  });

  it("switching the language changes the text, remembers the choice and sets <html lang>", async () => {
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    render(<I18nProvider><LanguageSwitch /><Probe /></I18nProvider>);
    await userEvent.selectOptions(screen.getByRole("combobox"), "tr");
    expect(screen.getByTestId("p")).toHaveTextContent("tr:Projeler");
    expect(localStorage.getItem("traqs.lang")).toBe("tr");
    expect(document.documentElement.lang).toBe("tr");
    // a new session starts in the saved language
    expect(detectLanguage()).toBe("tr");
    await userEvent.selectOptions(screen.getByRole("combobox"), "en");
    expect(screen.getByTestId("p")).toHaveTextContent("en:Projects");
  });

  it("the login screen has the language switch and translates", async () => {
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    render(<I18nProvider><AuthProvider><Login /></AuthProvider></I18nProvider>);
    expect(screen.getByLabelText("User name")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Language" }), "tr");
    expect(screen.getByLabelText("Kullanıcı adı")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giriş yap" })).toBeInTheDocument();
  });
});
