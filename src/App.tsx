import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { TopBar, type ActiveTab } from "./components/TopBar";
import { OverviewView } from "./components/OverviewView";
import { TrainingPlanView } from "./components/TrainingPlanView";
import { ActivitiesView } from "./components/ActivitiesView";
import { ZonesView } from "./components/ZonesView";
import { HealthView } from "./components/HealthView";
import { AiCoachView } from "./components/AiCoachView";
import { StrategyView } from "./components/StrategyView";
import { WeatherView } from "./components/WeatherView";
import { ConnectPanel } from "./components/ConnectPanel";
import { ActivityDetailModal } from "./components/ActivityDetailModal";
import { MetricDetailModal, type MetricType } from "./components/MetricDetailModal";
import type {
  IntervalsActivity,
  IntervalsSyncPayload,
} from "./types/intervals";
import {
  buildAiSummaryPayload,
  computeCriticalPower,
  computeDailyHeatmap,
  computeEfficiencySeries,
  computeIntensityScatter,
  computePmcSeries,
  computePowerCurveSummary,
  computeRunningSummary,
  computeSeilerPolarization,
  computeSportBreakdown,
  computeWeeklyVolume,
  computeWeeklyZoneStack,
  computeZoneDistribution,
  filterActivitiesByRangeAndSport,
  generateDeterministicInsights,
  type SportFilter,
} from "./utils/analytics";

const SESSION_KEY = "darierpro_intervals_session";
const STRAVA_SESSION_KEY = "darierpro_strava_session";
const THEME_KEY = "darierpro_theme";

interface StoredCreds {
  service?: "intervals" | "strava";
  athleteId: string;
  accessToken: string;
  userFtp?: number;
  userWeight?: number;
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored !== null) return stored === "dark";
      return false; // Default clean light mode as shown in user screenshot
    } catch {
      return false;
    }
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>("plan");
  const [daysWindow, setDaysWindow] = useState<number>(90);
  const [sportFilter, setSportFilter] = useState<SportFilter>("cycling");

  const [serverConfigured, setServerConfigured] = useState(false);
  const [initialAthleteId, setInitialAthleteId] = useState("0");
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Persistent session credentials so user is never logged out
  const [creds, setCreds] = useState<StoredCreds | null>(() => {
    try {
      const stravaRaw =
        localStorage.getItem(STRAVA_SESSION_KEY) ||
        sessionStorage.getItem(STRAVA_SESSION_KEY);
      if (stravaRaw) return JSON.parse(stravaRaw) as StoredCreds;
      const raw =
        localStorage.getItem(SESSION_KEY) ||
        sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as StoredCreds) : null;
    } catch {
      return null;
    }
  });

  const [payload, setPayload] = useState<IntervalsSyncPayload | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] =
    useState<IntervalsActivity | null>(null);
  const [activeDetailMetric, setActiveDetailMetric] = useState<MetricType | null>(null);
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);
  const [pendingRouteId, setPendingRouteId] = useState<string | null>(null);

  useEffect(() => {
    const onQuota = () => setGmpQuotaExceeded(true);
    window.addEventListener("gmp-quota-exceeded", onQuota);
    return () => window.removeEventListener("gmp-quota-exceeded", onQuota);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    try {
      localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light");
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  const performApiSync = useCallback(
    async (opts?: {
      athleteId?: string;
      accessToken?: string;
      rememberSession?: boolean;
    }) => {
      setIsSyncing(true);
      setSyncError(null);
      try {
        const res = await fetch("/api/intervals/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            athleteId: opts?.athleteId,
            accessToken: opts?.accessToken,
            days: 365,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Nie udało się zsynchronizować danych.");
        }

        // Store session so refresh keeps user logged in
        if (opts?.accessToken) {
          const nextCreds: StoredCreds = {
            athleteId: opts.athleteId || "0",
            accessToken: opts.accessToken,
          };
          setCreds(nextCreds);
          try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(nextCreds));
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextCreds));
          } catch {
            // Ignore storage errors
          }
        }

        setPayload(data as IntervalsSyncPayload);
        setShowConnectModal(false);
      } catch (err) {
        setSyncError(
          err instanceof Error
            ? err.message
            : "Błąd podczas synchronizacji z Intervals.icu."
        );
      } finally {
        setIsSyncing(false);
      }
    },
    []
  );

  const performStravaSync = useCallback(
    async (opts: {
      accessToken: string;
      userFtp?: number;
      userWeight?: number;
      rememberSession?: boolean;
    }) => {
      setIsSyncing(true);
      setSyncError(null);
      try {
        const res = await fetch("/api/strava/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: opts.accessToken,
            userFtp: opts.userFtp,
            userWeight: opts.userWeight,
            days: 365,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Nie udało się zsynchronizować danych ze Strava.");
        }

        if (opts.rememberSession !== false) {
          const nextCreds: StoredCreds = {
            service: "strava",
            athleteId: String(data.athlete?.id || "strava"),
            accessToken: opts.accessToken,
            userFtp: opts.userFtp,
            userWeight: opts.userWeight,
          };
          setCreds(nextCreds);
          try {
            localStorage.setItem(STRAVA_SESSION_KEY, JSON.stringify(nextCreds));
            sessionStorage.setItem(STRAVA_SESSION_KEY, JSON.stringify(nextCreds));
          } catch {
            // ignore
          }
        }

        setPayload(data as IntervalsSyncPayload);
        setShowConnectModal(false);
      } catch (err) {
        setSyncError(
          err instanceof Error
            ? err.message
            : "Błąd podczas synchronizacji ze Strava."
        );
      } finally {
        setIsSyncing(false);
      }
    },
    []
  );

  // Global popup listener for Strava OAuth callback
  useEffect(() => {
    const handleGlobalMessage = (event: MessageEvent) => {
      if (event.data?.type === "STRAVA_AUTH_SUCCESS") {
        const token = event.data.payload?.accessToken;
        if (token) {
          performStravaSync({
            accessToken: token,
            rememberSession: true,
          });
        }
      }
    };
    window.addEventListener("message", handleGlobalMessage);
    return () => window.removeEventListener("message", handleGlobalMessage);
  }, [performStravaSync]);

  // Initialize and auto-sync if server credentials or stored credentials exist
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const rawStrava =
          localStorage.getItem(STRAVA_SESSION_KEY) ||
          sessionStorage.getItem(STRAVA_SESSION_KEY);
        if (rawStrava) {
          try {
            const parsed = JSON.parse(rawStrava) as StoredCreds;
            if (parsed.accessToken) {
              setCreds(parsed);
              await performStravaSync({
                accessToken: parsed.accessToken,
                userFtp: parsed.userFtp,
                userWeight: parsed.userWeight,
                rememberSession: true,
              });
              if (!cancelled) setCheckingStatus(false);
              return;
            }
          } catch {
            // ignore
          }
        }

        const res = await fetch("/api/intervals/status");
        const status = (await res.json()) as {
          serverConfigured: boolean;
          athleteIdHint: string | null;
        };
        if (cancelled) return;

        setServerConfigured(status.serverConfigured);
        if (status.athleteIdHint) setInitialAthleteId(status.athleteIdHint);

        if (status.serverConfigured) {
          await performApiSync({ athleteId: status.athleteIdHint || "0" });
        } else if (creds?.accessToken && creds.service !== "strava") {
          await performApiSync({
            athleteId: creds.athleteId,
            accessToken: creds.accessToken,
            rememberSession: true,
          });
        }
      } catch {
        // Keep manual connect state
      } finally {
        if (!cancelled) setCheckingStatus(false);
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePrimaryTopBarAction = () => {
    if (!payload) {
      setShowConnectModal(true);
      return;
    }
    if (payload.source === "file") {
      setShowConnectModal(true);
      return;
    }
    if (payload.source === "strava" || creds?.service === "strava") {
      if (creds?.accessToken) {
        performStravaSync({
          accessToken: creds.accessToken,
          userFtp: creds.userFtp,
          userWeight: creds.userWeight,
          rememberSession: true,
        });
      } else {
        setShowConnectModal(true);
      }
      return;
    }
    if (serverConfigured && !creds?.accessToken) {
      performApiSync({ athleteId: initialAthleteId });
    } else if (creds?.accessToken) {
      performApiSync({
        athleteId: creds.athleteId,
        accessToken: creds.accessToken,
        rememberSession: true,
      });
    } else {
      setShowConnectModal(true);
    }
  };

  // Analytics pipeline
  const filteredActivities = useMemo(() => {
    if (!payload) return [];
    return filterActivitiesByRangeAndSport(
      payload.activities,
      daysWindow,
      sportFilter
    );
  }, [payload, daysWindow, sportFilter]);

  const pmcSeries = useMemo(() => {
    if (!payload) return [];
    return computePmcSeries(payload.activities, payload.wellness, daysWindow);
  }, [payload, daysWindow]);

  const weeklyVolume = useMemo(
    () => computeWeeklyVolume(filteredActivities),
    [filteredActivities]
  );

  const powerZones = useMemo(
    () => computeZoneDistribution(filteredActivities, "power"),
    [filteredActivities]
  );

  const hrZones = useMemo(
    () => computeZoneDistribution(filteredActivities, "hr"),
    [filteredActivities]
  );

  const efficiencySeries = useMemo(
    () => computeEfficiencySeries(filteredActivities),
    [filteredActivities]
  );

  const weeklyZoneStack = useMemo(
    () => computeWeeklyZoneStack(filteredActivities),
    [filteredActivities]
  );

  const intensityScatter = useMemo(
    () => computeIntensityScatter(filteredActivities),
    [filteredActivities]
  );

  const heatmapCells = useMemo(
    () => computeDailyHeatmap(filteredActivities, 180),
    [filteredActivities]
  );

  const sportBreakdown = useMemo(() => {
    if (!payload) return [];
    return computeSportBreakdown(payload.activities);
  }, [payload]);

  const deterministicInsights = useMemo(() => {
    if (!payload) return [];
    return generateDeterministicInsights(
      pmcSeries,
      weeklyVolume,
      powerZones,
      hrZones,
      efficiencySeries
    );
  }, [payload, pmcSeries, weeklyVolume, powerZones, hrZones, efficiencySeries]);

  const powerSummary = useMemo(
    () =>
      computePowerCurveSummary(
        payload?.powerCurves,
        payload?.athlete.weight
      ),
    [payload?.powerCurves, payload?.athlete.weight]
  );

  const cpModel = useMemo(
    () => computeCriticalPower(powerSummary.benchmarks),
    [powerSummary.benchmarks]
  );

  const athleteFtp = useMemo(() => {
    const rideSettings = payload?.athlete.sportSettings?.find(
      (s) => typeof s.ftp === "number" && s.ftp > 0
    );
    return rideSettings?.ftp || cpModel.cpWatts || 220;
  }, [payload?.athlete.sportSettings, cpModel.cpWatts]);

  const runningSummary = useMemo(() => {
    const runSettings = payload?.athlete.sportSettings?.find((s) =>
      s.types?.some((t) => t.toLowerCase().includes("run"))
    );
    return computeRunningSummary(
      payload?.paceCurves,
      filteredActivities,
      runSettings?.threshold_pace
    );
  }, [payload?.paceCurves, payload?.athlete.sportSettings, filteredActivities]);

  const currentPolarization = useMemo(() => {
    const primary =
      powerZones.reduce((s, z) => s + z.secs, 0) > 0 ? powerZones : hrZones;
    return computeSeilerPolarization(primary);
  }, [powerZones, hrZones]);

  const aiSummaryPayload = useMemo(() => {
    if (!payload) return {};
    return buildAiSummaryPayload(
      payload.athlete,
      filteredActivities,
      payload.wellness,
      pmcSeries,
      weeklyVolume,
      powerZones,
      hrZones,
      efficiencySeries
    );
  }, [
    payload,
    filteredActivities,
    pmcSeries,
    weeklyVolume,
    powerZones,
    hrZones,
    efficiencySeries,
  ]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <TopBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setShowConnectModal(false);
          setActiveTab(tab);
        }}
        isConnected={Boolean(payload)}
        athleteName={payload?.athlete.name}
        athleteId={payload?.athlete.id}
        source={payload?.source}
        isSyncing={isSyncing}
        onPrimaryAction={handlePrimaryTopBarAction}
        onOpenSettings={() => setShowConnectModal(true)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((m) => !m)}
        sportFilter={sportFilter}
        onSportFilterChange={setSportFilter}
        daysWindow={daysWindow}
        onDaysWindowChange={setDaysWindow}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === "weather" ? (
          <WeatherView
            darkMode={darkMode}
            athleteWeightKg={payload?.athlete.weight}
            athleteFtp={athleteFtp}
            pendingRouteId={pendingRouteId}
            onClearPendingRoute={() => setPendingRouteId(null)}
          />
        ) : checkingStatus && !payload ? (
          <div className="space-y-6 py-12">
            <div className="h-10 w-64 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0, 1, 2].map((k) => (
                <div
                  key={k}
                  className="h-32 animate-pulse rounded-3xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900"
                />
              ))}
            </div>
            <div className="h-96 animate-pulse rounded-3xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900" />
          </div>
        ) : !payload ? (
          <ConnectPanel
            serverConfigured={serverConfigured}
            initialAthleteId={initialAthleteId}
            isSyncing={isSyncing}
            error={syncError}
            onSyncApi={({ athleteId, accessToken, rememberSession }) =>
              performApiSync({ athleteId, accessToken, rememberSession })
            }
            onSyncServerEnv={() =>
              performApiSync({ athleteId: initialAthleteId })
            }
            onSyncStrava={performStravaSync}
            onImportFile={(imported) => {
              setPayload(imported);
              setSyncError(null);
            }}
          />
        ) : (
          <div>
            {syncError && (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{syncError}</span>
              </div>
            )}

            {/* Main Active Tab View */}
            {activeTab === "overview" && (
              <OverviewView
                activities={filteredActivities}
                pmc={pmcSeries}
                weekly={weeklyVolume}
                sportBreakdown={sportBreakdown}
                insights={deterministicInsights}
                wellness={payload.wellness}
                heatmapCells={heatmapCells}
                intensityScatter={intensityScatter}
                onSelectActivity={setSelectedActivity}
                onNavigateTab={(tab) => {
                  if (tab === "activities") setActiveTab("activities");
                  else if (tab === "zones") setActiveTab("zones");
                  else if (tab === "ai") setActiveTab("ai");
                }}
              />
            )}

            {activeTab === "plan" && (
              <TrainingPlanView
                athlete={payload.athlete}
                activities={filteredActivities}
                events={payload.events}
                cpModel={cpModel}
                accessToken={creds?.accessToken}
                athleteId={creds?.athleteId || initialAthleteId}
                source={payload.source}
                onPlanPushed={handlePrimaryTopBarAction}
                onSelectActivity={setSelectedActivity}
              />
            )}

            {activeTab === "activities" && (
              <ActivitiesView
                activities={filteredActivities}
                allActivities={payload.activities}
                events={payload.events}
                onSelectActivity={setSelectedActivity}
              />
            )}

            {activeTab === "zones" && (
              <ZonesView
                powerZones={powerZones}
                hrZones={hrZones}
                efficiency={efficiencySeries}
                weeklyZoneStack={weeklyZoneStack}
                intensityScatter={intensityScatter}
                powerSummary={powerSummary}
                cpModel={cpModel}
                runningSummary={runningSummary}
              />
            )}

            {activeTab === "health" && (
              <HealthView
                athlete={payload.athlete}
                wellness={payload.wellness}
                activities={filteredActivities}
                pmc={pmcSeries}
                hrZones={hrZones}
                daysWindow={daysWindow}
                source={payload.source}
                athleteId={creds?.athleteId || initialAthleteId}
                accessToken={creds?.accessToken}
                onWellnessSaved={handlePrimaryTopBarAction}
                onOpenMetricModal={(m) => setActiveDetailMetric(m)}
              />
            )}

            {activeTab === "ai" && (
              <AiCoachView
                summaryPayload={aiSummaryPayload}
                source={payload.source}
                athleteId={creds?.athleteId || initialAthleteId}
                accessToken={creds?.accessToken}
                currentCtl={pmcSeries[pmcSeries.length - 1]?.ctl ?? 51}
                currentAtl={pmcSeries[pmcSeries.length - 1]?.atl ?? 47}
                currentPolarization={currentPolarization}
                onPlanPushed={handlePrimaryTopBarAction}
              />
            )}

            {activeTab === "strategy" && (
              <StrategyView
                athlete={payload.athlete}
                activities={filteredActivities}
                allActivities={payload.activities}
                runningSummary={runningSummary}
                cpModel={cpModel}
              />
            )}
          </div>
        )}
      </main>

      {/* Settings / Connection Modal when athlete is connected */}
      {showConnectModal && payload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setShowConnectModal(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <h3 className="mb-4 font-display text-lg font-bold text-slate-900 dark:text-white">
              Połączenie konta (Strava / Intervals.icu)
            </h3>
            <ConnectPanel
              serverConfigured={serverConfigured}
              initialAthleteId={initialAthleteId}
              isSyncing={isSyncing}
              error={syncError}
              onSyncApi={({ athleteId, accessToken, rememberSession }) =>
                performApiSync({ athleteId, accessToken, rememberSession })
              }
              onSyncServerEnv={() =>
                performApiSync({ athleteId: initialAthleteId })
              }
              onSyncStrava={performStravaSync}
              onImportFile={(imported) => {
                setPayload(imported);
                setSyncError(null);
                setShowConnectModal(false);
              }}
              onCancel={() => setShowConnectModal(false)}
            />
          </div>
        </div>
      )}

      {/* Activity Detail Modal */}
      <ActivityDetailModal
        activity={selectedActivity}
        accessToken={creds?.accessToken}
        source={payload?.source || "api"}
        onClose={() => setSelectedActivity(null)}
        onOpenRouteInWeather={(routeId) => {
          setPendingRouteId(routeId);
          setActiveTab("weather");
        }}
      />

      {/* Metric Detail Modal (Resting HR, HRV, Weight, Steps, TSB, Readiness, ACWR) */}
      {activeDetailMetric !== null && payload && (
        <MetricDetailModal
          initialMetric={activeDetailMetric}
          pmc={pmcSeries}
          wellness={payload.wellness}
          onClose={() => setActiveDetailMetric(null)}
        />
      )}
    </div>
  );
}
