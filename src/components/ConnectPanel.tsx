import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Flame,
  KeyRound,
  ShieldCheck,
  Upload,
  Zap,
} from "lucide-react";
import type { IntervalsSyncPayload } from "../types/intervals";
import { parseIntervalsExportFile } from "../utils/importer";

interface ConnectPanelProps {
  serverConfigured: boolean;
  initialAthleteId: string;
  isSyncing: boolean;
  error: string | null;
  onSyncApi: (opts: {
    athleteId: string;
    accessToken: string;
    rememberSession: boolean;
  }) => Promise<void>;
  onSyncServerEnv: () => Promise<void>;
  onSyncStrava: (opts: {
    accessToken: string;
    userFtp?: number;
    userWeight?: number;
    rememberSession: boolean;
  }) => Promise<void>;
  onImportFile: (payload: IntervalsSyncPayload) => void;
  onCancel?: () => void;
  initialMode?: "api" | "strava" | "file";
}

export const ConnectPanel: React.FC<ConnectPanelProps> = ({
  serverConfigured,
  initialAthleteId,
  isSyncing,
  error,
  onSyncApi,
  onSyncServerEnv,
  onSyncStrava,
  onImportFile,
  onCancel,
  initialMode = "strava",
}) => {
  const [mode, setMode] = useState<"api" | "strava" | "file">(initialMode);
  const [athleteId, setAthleteId] = useState(initialAthleteId || "0");
  const [accessToken, setAccessToken] = useState("");
  const [rememberSession, setRememberSession] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Strava specific state
  const [stravaToken, setStravaToken] = useState("");
  const [stravaClientId, setStravaClientId] = useState("");
  const [stravaClientSecret, setStravaClientSecret] = useState("");
  const [stravaFtp, setStravaFtp] = useState<number | "">(250);
  const [stravaWeight, setStravaWeight] = useState<number | "">(75);
  const [stravaServerConfigured, setStravaServerConfigured] = useState(false);
  const [stravaRedirectUri, setStravaRedirectUri] = useState(
    "https://ais-dev-ntqua7zs5iqcqjs6ppq2ai-727932171346.europe-west2.run.app/api/strava/callback"
  );
  const [stravaCallbackDomain, setStravaCallbackDomain] = useState(
    "ais-dev-ntqua7zs5iqcqjs6ppq2ai-727932171346.europe-west2.run.app"
  );
  const [isOpeningStravaOAuth, setIsOpeningStravaOAuth] = useState(false);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [showStravaAppConfig, setShowStravaAppConfig] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Check Strava server config status on mount
  useEffect(() => {
    let cancelled = false;
    async function checkStrava() {
      try {
        const res = await fetch("/api/strava/status");
        if (res.ok) {
          const data = (await res.json()) as {
            configured: boolean;
            clientId?: string | null;
            redirectUri: string;
            callbackDomain: string;
          };
          if (!cancelled) {
            setStravaServerConfigured(data.configured);
            if (data.clientId) setStravaClientId(data.clientId);
            if (data.redirectUri) setStravaRedirectUri(data.redirectUri);
            if (data.callbackDomain) setStravaCallbackDomain(data.callbackDomain);
          }
        }
      } catch {
        // ignore
      }
    }
    checkStrava();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyToClipboard = (text: string, fieldId: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback
    }
  };

  const handleApiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSyncApi({
      athleteId: athleteId.trim() || "0",
      accessToken: accessToken.trim(),
      rememberSession,
    });
  };

  const handleStravaTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStravaError(null);
    if (!stravaToken.trim()) {
      setStravaError("Wprowadź token dostępu Strava (Personal Access Token).");
      return;
    }
    try {
      await onSyncStrava({
        accessToken: stravaToken.trim(),
        userFtp: stravaFtp ? Number(stravaFtp) : undefined,
        userWeight: stravaWeight ? Number(stravaWeight) : undefined,
        rememberSession,
      });
    } catch (err) {
      setStravaError(
        err instanceof Error ? err.message : "Błąd synchronizacji ze Strava."
      );
    }
  };

  const handleStartStravaOAuth = async () => {
    setStravaError(null);
    setIsOpeningStravaOAuth(true);
    try {
      const params = new URLSearchParams();
      if (stravaClientId.trim()) params.set("clientId", stravaClientId.trim());
      if (stravaClientSecret.trim())
        params.set("clientSecret", stravaClientSecret.trim());

      const res = await fetch(
        `/api/strava/auth-url?${params.toString()}`
      );
      const data = (await res.json()) as {
        authUrl?: string;
        error?: string;
        redirectUri?: string;
      };

      if (!res.ok || !data.authUrl) {
        throw new Error(
          data.error ||
            "Nie udało się wygenerować adresu autoryzacji Strava. Upewnij się, że Client ID jest wpisane lub skonfigurowane w pliku .env."
        );
      }

      // Open provider URL directly in popup per oauth-integration skill
      const popup = window.open(
        data.authUrl,
        "strava_oauth",
        "width=600,height=720,status=no,resizable=yes,scrollbars=yes"
      );

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        throw new Error(
          "Przeglądarka zablokowała wyskakujące okienko (popup). Zezwól na wyskakujące okna i spróbuj ponownie."
        );
      }

      const handleMessage = async (event: MessageEvent) => {
        if (event.data?.type === "STRAVA_AUTH_SUCCESS") {
          window.removeEventListener("message", handleMessage);
          setIsOpeningStravaOAuth(false);
          const payload = event.data.payload as { accessToken?: string };
          if (payload?.accessToken) {
            await onSyncStrava({
              accessToken: payload.accessToken,
              userFtp: stravaFtp ? Number(stravaFtp) : undefined,
              userWeight: stravaWeight ? Number(stravaWeight) : undefined,
              rememberSession,
            });
          }
        } else if (event.data?.type === "STRAVA_AUTH_ERROR") {
          window.removeEventListener("message", handleMessage);
          setIsOpeningStravaOAuth(false);
          setStravaError(
            event.data.error || "Wystąpił błąd podczas autoryzacji Strava."
          );
        }
      };

      window.addEventListener("message", handleMessage);
    } catch (err) {
      setIsOpeningStravaOAuth(false);
      setStravaError(
        err instanceof Error
          ? err.message
          : "Nie udało się uruchomić autoryzacji Strava."
      );
    }
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      const text = await file.text();
      const payload = parseIntervalsExportFile(file.name, text);
      onImportFile(payload);
    } catch (err) {
      setFileError(
        err instanceof Error ? err.message : "Nie udało się odczytać pliku."
      );
    }
  };

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 px-2.5 py-0.5 text-xs font-bold mb-2">
              <Flame className="h-3.5 w-3.5 fill-current" />
              <span>Integracja z platformami sportowymi</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Połącz konto lub zaimportuj dane
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              Pobierz aktywności, wylicz automatycznie obciążenie Coggan TSS, IF, NP, strefy mocy i tętna oraz importuj trasy GPX do symulatora pogody.
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white whitespace-nowrap cursor-pointer"
            >
              Anuluj
            </button>
          )}
        </div>

        {serverConfigured && mode === "api" && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
            <span className="text-blue-900 dark:text-blue-200">
              Wykryto konfigurację serwerową Intervals.icu w zmiennych środowiskowych.
            </span>
            <button
              type="button"
              disabled={isSyncing}
              onClick={onSyncServerEnv}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              {isSyncing ? "Pobieranie..." : "Pobierz z konfiguracji serwera"}
            </button>
          </div>
        )}

        {/* Segmented mode switcher */}
        <div className="mt-6 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setMode("strava")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
              mode === "strava"
                ? "bg-[#fc5200] text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>Strava</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("api")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
              mode === "api"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span>Intervals.icu</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
              mode === "file"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Upload className="h-3.5 w-3.5 text-indigo-500" />
            <span>Plik CSV / JSON</span>
          </button>
        </div>

        {/* ================================================================ */}
        {/* STRAVA MODE */}
        {/* ================================================================ */}
        {mode === "strava" && (
          <div className="mt-6 space-y-6">
            {/* Athlete calibration fields */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
              <div>
                <label
                  htmlFor="strava-ftp"
                  className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Twoje FTP (Waty)
                </label>
                <input
                  id="strava-ftp"
                  type="number"
                  min="50"
                  max="600"
                  value={stravaFtp}
                  onChange={(e) =>
                    setStravaFtp(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="np. 250"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Do wyliczenia TSS, IF i stref Coggana
                </span>
              </div>
              <div>
                <label
                  htmlFor="strava-weight"
                  className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Waga kolarza (kg)
                </label>
                <input
                  id="strava-weight"
                  type="number"
                  min="35"
                  max="200"
                  value={stravaWeight}
                  onChange={(e) =>
                    setStravaWeight(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="np. 75"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Do wskaźników W/kg i symulacji wiatru
                </span>
              </div>
            </div>

            {/* Sposób 1: 1-Click Popup OAuth 2.0 */}
            <div className="rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-950/20 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fc5200] text-white font-bold text-xs">
                    1
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      1-kliknięcie: Logowanie OAuth 2.0
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Otwiera oficjalne okno autoryzacji Strava w wyskakującym oknie popup.
                    </p>
                  </div>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Oficjalne OAuth
                </span>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  disabled={isSyncing || isOpeningStravaOAuth}
                  onClick={handleStartStravaOAuth}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#fc5200] hover:bg-[#e04900] active:scale-[0.99] text-white px-5 py-3 text-sm font-bold shadow-md shadow-orange-600/20 transition-all disabled:opacity-60 cursor-pointer"
                >
                  <Flame className="h-4 w-4 fill-current" />
                  <span>
                    {isOpeningStravaOAuth
                      ? "Oczekiwanie na autoryzację w oknie Strava..."
                      : isSyncing
                      ? "Pobieranie treningów..."
                      : "Zaloguj przez Strava (OAuth Popup)"}
                  </span>
                </button>
              </div>

              {/* Toggle manual App configuration details */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowStravaAppConfig(!showStravaAppConfig)}
                  className="text-xs font-semibold text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>
                    {showStravaAppConfig
                      ? "Ukryj konfigurację aplikacji Strava API"
                      : "Konfiguracja własnej aplikacji Strava API (Client ID / Callback)"}
                  </span>
                </button>

                {showStravaAppConfig && (
                  <div className="mt-3 space-y-3 rounded-lg border border-orange-200 dark:border-orange-900/50 bg-white dark:bg-slate-900 p-4 text-xs">
                    <p className="text-slate-600 dark:text-slate-300">
                      Aby autoryzować przez OAuth, zarejestruj aplikację na stronie{" "}
                      <a
                        href="https://www.strava.com/settings/api"
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-orange-600 hover:underline inline-flex items-center gap-0.5"
                      >
                        strava.com/settings/api
                        <ExternalLink className="h-3 w-3" />
                      </a>{" "}
                      i podaj poniższe parametry:
                    </p>

                    <div className="space-y-2 font-mono text-[11px]">
                      <div>
                        <div className="text-[10px] font-sans font-bold uppercase text-slate-500">
                          Application Name:
                        </div>
                        <div className="text-slate-800 dark:text-slate-200 font-semibold">
                          DarierPro Cycling Analytics
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[10px] font-sans font-bold uppercase text-slate-500">
                          <span>Authorization Callback Domain:</span>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(stravaCallbackDomain, "domain")
                            }
                            className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 font-sans cursor-pointer"
                          >
                            {copiedField === "domain" ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            <span>{copiedField === "domain" ? "Skopiowano" : "Kopiuj"}</span>
                          </button>
                        </div>
                        <div className="p-1.5 rounded bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-white break-all select-all">
                          {stravaCallbackDomain}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[10px] font-sans font-bold uppercase text-slate-500">
                          <span>Pełny Callback URL:</span>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(stravaRedirectUri, "url")
                            }
                            className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 font-sans cursor-pointer"
                          >
                            {copiedField === "url" ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            <span>{copiedField === "url" ? "Skopiowano" : "Kopiuj"}</span>
                          </button>
                        </div>
                        <div className="p-1.5 rounded bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-white break-all select-all">
                          {stravaRedirectUri}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor="strava-cid"
                          className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Client ID (ze Strava API)
                        </label>
                        <input
                          id="strava-cid"
                          type="text"
                          value={stravaClientId}
                          onChange={(e) => setStravaClientId(e.target.value)}
                          placeholder="np. 123456"
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="strava-csec"
                          className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Client Secret
                        </label>
                        <input
                          id="strava-csec"
                          type="password"
                          value={stravaClientSecret}
                          onChange={(e) => setStravaClientSecret(e.target.value)}
                          placeholder="Wklej Client Secret..."
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sposób 2: Direct Personal Access Token */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs">
                  2
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Błyskawiczne: Osobisty Access Token (bez rejestracji aplikacji)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Wystarczy skopiować gotowy token z zakładki dewelopera Strava.
                  </p>
                </div>
              </div>

              <form onSubmit={handleStravaTokenSubmit} className="mt-3 space-y-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>
                    Skopiuj wartość pola{" "}
                    <strong className="text-slate-800 dark:text-slate-200">
                      Your Access Token
                    </strong>{" "}
                    ze strony{" "}
                    <a
                      href="https://www.strava.com/settings/api"
                      target="_blank"
                      rel="noreferrer"
                      className="text-orange-600 hover:underline inline-flex items-center gap-0.5 font-medium"
                    >
                      strava.com/settings/api
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="password"
                    value={stravaToken}
                    onChange={(e) => setStravaToken(e.target.value)}
                    placeholder="Wklej Your Access Token ze Strava..."
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-500"
                  />
                  <button
                    type="submit"
                    disabled={isSyncing || !stravaToken.trim()}
                    className="rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-xs font-bold hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {isSyncing ? "Pobieranie..." : "Synchronizuj ze Strava"}
                  </button>
                </div>
              </form>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-600"
              />
              <span>Zapamiętaj sesję Strava w tej przeglądarce</span>
            </label>

            {(error || stravaError) && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{stravaError || error}</span>
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* INTERVALS.ICU MODE */}
        {/* ================================================================ */}
        {mode === "api" && (
          <form onSubmit={handleApiSubmit} className="mt-6 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <div className="font-semibold text-slate-900 dark:text-slate-200">
                Skąd pobrać dane połączenia w Intervals.icu:
              </div>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                <li>
                  Zaloguj się na{" "}
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    intervals.icu
                  </span>{" "}
                  i przejdź do{" "}
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    Settings → Developer Settings
                  </span>
                  .
                </li>
                <li>
                  Skopiuj swój osobisty token dostępu (Personal Token) oraz opcjonalnie Athlete ID (np.{" "}
                  <span className="font-mono">i12345</span> lub zostaw{" "}
                  <span className="font-mono">0</span> dla własnego konta).
                </li>
                <li>
                  Połączenie realizowane jest przez serwerowe proxy aplikacji wyłącznie w celu pobrania Twoich treningów.
                </li>
              </ol>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="athlete-id"
                  className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Athlete ID
                </label>
                <input
                  id="athlete-id"
                  type="text"
                  value={athleteId}
                  onChange={(e) => setAthleteId(e.target.value)}
                  placeholder="0 lub i12345"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="intervals-token"
                  className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Token dostępu Intervals.icu (Developer Settings)
                </label>
                <input
                  id="intervals-token"
                  type="password"
                  required
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Wklej token z Developer Settings..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Zapamiętaj w tej sesji przeglądarki do szybkiego odświeżania</span>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSyncing || !accessToken.trim()}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {isSyncing ? "Pobieranie aktywności z Intervals.icu..." : "Pobierz aktywności i analizuj"}
            </button>
          </form>
        )}

        {/* ================================================================ */}
        {/* FILE IMPORT MODE */}
        {/* ================================================================ */}
        {mode === "file" && (
          <div className="mt-6 space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFileChange(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition-colors hover:border-blue-500 hover:bg-slate-100/70 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-blue-500 dark:hover:bg-slate-900"
            >
              <Upload className="h-7 w-7 text-slate-400" aria-hidden="true" />
              <div className="mt-3 text-sm font-medium text-slate-900 dark:text-white">
                Upuść plik activities.csv lub .json z Intervals.icu / Strava
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                W Intervals.icu: Activities → List → Download CSV
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
              />
            </div>

            {fileError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{fileError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
