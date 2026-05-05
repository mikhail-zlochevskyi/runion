"use client";

import "leaflet/dist/leaflet.css";

import { Check, ChevronDown, LocateFixed, MapPin, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { CitySlug, Run } from "@/lib/types";
import { CITY_CONFIG } from "@/lib/config";
import { openSpots, paceLabel } from "@/lib/runs";

type Props = {
  initialCity: CitySlug;
  initialRuns: Run[];
};

type SheetState = "hidden" | "peek" | "full";
type ViewMode = "map" | "post" | "runs";

const SHEET_STATES: SheetState[] = ["hidden", "peek", "full"];

export function RunionMobileApp({ initialCity, initialRuns }: Props) {
  const [city] = useState(initialCity);
  const [runs, setRuns] = useState(initialRuns);
  const [activeRunId, setActiveRunId] = useState(initialRuns[0]?.id ?? "");
  const [isDetailOpen, setIsDetailOpen] = useState(Boolean(initialRuns[0]));
  const [sheetState, setSheetState] = useState<SheetState>("peek");
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [joinedRuns, setJoinedRuns] = useState<Run[]>([]);
  const [dragY, setDragY] = useState<number | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef({ active: false, moved: false, startY: 0, startSheetY: 0, currentY: 0 });
  const leafletRef = useRef<{
    map: import("leaflet").Map;
    markers: import("leaflet").Marker[];
  } | null>(null);

  const cityConf = CITY_CONFIG[city];
  const activeRun = runs.find((run) => run.id === activeRunId) ?? runs[0];

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (filter === "all") return true;
      if (filter === "easy") return /easy|social/i.test(run.goal);
      if (filter === "tempo") return /tempo/i.test(run.goal);
      return paceLabel(run) === filter;
    });
  }, [filter, runs]);

  useEffect(() => {
    let cancelled = false;

    async function bootMap() {
      if (!mapRef.current || leafletRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: cityConf.center,
        zoom: cityConf.zoom,
        zoomControl: false,
        attributionControl: false
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19
      }).addTo(map);

      L.marker(cityConf.youLL, {
        icon: L.divIcon({
          className: "",
          html: '<div class="you-marker"><div class="you-pulse"></div><div class="you-dot"></div></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }),
        interactive: false
      }).addTo(map);

      leafletRef.current = { map, markers: [] };
    }

    bootMap();

    return () => {
      cancelled = true;
    };
  }, [cityConf.center, cityConf.youLL, cityConf.zoom]);

  useEffect(() => {
    async function renderMarkers() {
      const state = leafletRef.current;
      if (!state) return;
      const L = await import("leaflet");

      state.markers.forEach((marker) => marker.remove());
      state.markers = runs.map((run) => {
        const active = run.id === activeRunId;
        const full = openSpots(run) === 0;
        const html = `
          <div class="runion-pin ${active ? "active" : ""} ${full ? "full" : ""}">
            <div class="pin-glow"></div>
            <div class="mark">${run.paceMin}</div>
          </div>`;
        const marker = L.marker([run.lat, run.lng], {
          icon: L.divIcon({
            className: "",
            html,
            iconSize: active ? [60, 60] : [44, 44],
            iconAnchor: active ? [30, 30] : [22, 22]
          })
        }).addTo(state.map);
        marker.on("click", () => selectRun(run));
        return marker;
      });
    }

    renderMarkers();
  }, [activeRunId, runs]);

  function selectRun(run: Run) {
    setActiveRunId(run.id);
    setIsDetailOpen(true);
    setSheetState("peek");
    setDragY(null);
    leafletRef.current?.map.flyTo([run.lat, run.lng], 14, { duration: 0.6 });
  }

  function getSheetY(state: SheetState) {
    const height = sheetRef.current?.offsetHeight ?? Math.round(window.innerHeight * 0.88);

    if (state === "full") return 0;
    if (state === "hidden") return Math.max(0, height - 28);

    return Math.max(0, height - 380);
  }

  function snapSheet(y: number) {
    const closest = SHEET_STATES.reduce((best, state) => {
      const distance = Math.abs(getSheetY(state) - y);
      return distance < best.distance ? { state, distance } : best;
    }, { state: sheetState, distance: Number.POSITIVE_INFINITY });

    setSheetState(closest.state);
    setDragY(null);
  }

  function toggleSheet() {
    const next: Record<SheetState, SheetState> = {
      hidden: "peek",
      peek: "full",
      full: "hidden"
    };

    setSheetState(next[sheetState]);
    setDragY(null);
  }

  function startSheetDrag(event: PointerEvent<HTMLElement | HTMLButtonElement>) {
    if (event.button !== 0) return;

    const startSheetY = dragY ?? getSheetY(sheetState);
    dragRef.current = {
      active: true,
      moved: false,
      startY: event.clientY,
      startSheetY,
      currentY: startSheetY
    };
    setDragY(dragRef.current.startSheetY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSheetDrag(event: PointerEvent<HTMLElement | HTMLButtonElement>) {
    if (!dragRef.current.active) return;

    const maxY = getSheetY("hidden");
    const deltaY = event.clientY - dragRef.current.startY;
    const nextY = Math.min(maxY, Math.max(0, dragRef.current.startSheetY + deltaY));

    dragRef.current.currentY = nextY;
    dragRef.current.moved = dragRef.current.moved || Math.abs(deltaY) > 6;
    setDragY(nextY);
  }

  function endSheetDrag(event: PointerEvent<HTMLElement | HTMLButtonElement>) {
    if (!dragRef.current.active) return;

    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    snapSheet(dragRef.current.currentY);
  }

  function clickSheetChrome() {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }

    toggleSheet();
  }

  function joinRun(run: Run) {
    setJoinedRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    setRuns((current) =>
      current.map((item) =>
        item.id === run.id
          ? { ...item, spotsTaken: Math.min(item.spotsTotal, item.spotsTaken + 1), status: openSpots(item) <= 1 ? "full" : item.status }
          : item
      )
    );
    setViewMode("runs");
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div className="logo" aria-label="runion">
          <LogoMark />
          runi<span>o</span>n
        </div>
        <button
          className="icon-btn"
          aria-label="Find my location"
          onClick={() => leafletRef.current?.map.flyTo(cityConf.youLL, 14, { duration: 0.7 })}
        >
          <LocateFixed size={17} />
        </button>
      </div>

      <div ref={mapRef} id="map" />

      <section
        ref={sheetRef}
        className={`sheet ${sheetState} ${dragY !== null ? "dragging" : ""}`}
        style={dragY !== null ? ({ "--sheet-drag-y": `${dragY}px` } as CSSProperties) : undefined}
        aria-label="Runs near your pace"
      >
        <button
          className="drag-handle"
          aria-label="Toggle run sheet"
          onClick={clickSheetChrome}
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheetDrag}
          onPointerUp={endSheetDrag}
          onPointerCancel={endSheetDrag}
        />
        <header
          className="sheet-header"
          onClick={clickSheetChrome}
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheetDrag}
          onPointerUp={endSheetDrag}
          onPointerCancel={endSheetDrag}
        >
          <p className="sheet-eyebrow">Tuesday · 05 May</p>
          <h1>
            {filteredRuns.length} runs near
            <br />
            <span>your pace</span>
          </h1>
          <p>{cityConf.label} · runs near you</p>
        </header>

        <div className="filter-strip">
          {["all", "5:00-5:30", "5:30-6:00", "easy", "tempo"].map((item) => (
            <button key={item} className={`fpill ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>
              {item === "all" ? "All runs" : item === "easy" ? "Easy / social" : item === "tempo" ? "Tempo" : `${item} /km`}
            </button>
          ))}
        </div>

        <div className="run-list">
          {filteredRuns.map((run) => (
            <button key={run.id} className={`run-card ${run.id === activeRunId ? "active" : ""}`} onClick={() => selectRun(run)}>
              <span className="run-card-top">
                <span>
                  <strong>{run.locationName}</strong>
                  <small>
                    {run.day} · {run.time} · {run.distanceKm} KM ·{" "}
                    {openSpots(run) === 0 ? <em className="badge full">FULL</em> : <em className="badge">{openSpots(run)} SPOT</em>}
                  </small>
                </span>
                <b>{run.paceMin}</b>
              </span>
              <span className="run-card-foot">
                <span className="buddy">
                  <span className="avatar">{run.organiser.avatarInitial}</span>
                  <span>
                    <strong>{run.organiser.name}</strong>
                    <small>{run.clubName ?? "solo run"}</small>
                  </span>
                </span>
                <span className="view-pill">View</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {activeRun && isDetailOpen ? <RunDetail run={activeRun} onClose={() => setIsDetailOpen(false)} onJoin={() => joinRun(activeRun)} /> : null}

      <nav className="bottom-nav" aria-label="Primary">
        <button className={viewMode === "map" ? "active" : ""} onClick={() => setViewMode("map")}>
          <MapPin size={18} />
          Map
        </button>
        <button className={viewMode === "post" ? "active" : ""} onClick={() => setViewMode("post")}>
          <Plus size={18} />
          Post
        </button>
        <button className={viewMode === "runs" ? "active" : ""} onClick={() => setViewMode("runs")}>
          <Check size={18} />
          Runs
        </button>
      </nav>

      {viewMode === "post" ? <PostRunSheet onClose={() => setViewMode("map")} /> : null}
      {viewMode === "runs" ? <MyRunsSheet runs={joinedRuns} onClose={() => setViewMode("map")} /> : null}
    </main>
  );
}

function RunDetail({ run, onJoin, onClose }: { run: Run; onJoin: () => void; onClose: () => void }) {
  const spots = openSpots(run);

  return (
    <aside className="detail-sheet open" aria-label={`${run.locationName} run details`}>
      <div className="detail-hero">
        <button className="detail-close-btn" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
        <p>{run.day} · {run.runDate}</p>
        <h2>{run.locationName}</h2>
        <span>{run.route}</span>
      </div>
      <div className="detail-body">
        <div className="stat-grid">
          <Stat k="When" v={run.time} s={run.day} />
          <Stat k="Distance" v={String(run.distanceKm)} s="KM" />
          <Stat k="Pace" v={paceLabel(run)} s="/KM" />
          <Stat k="Goal" v={run.goal} />
        </div>
        <div className="organiser">
          <span className="avatar large">{run.organiser.avatarInitial}</span>
          <span>
            <strong>
              {run.organiser.name} {run.organiser.verified ? <em>VERIFIED</em> : null}
            </strong>
            <small>
              {run.clubName ?? "solo run"} · {run.organiser.runs} runs · {run.organiser.rating} stars
            </small>
          </span>
        </div>
        {run.womenOnly ? <div className="safety-note">Women-only run · enforced before join.</div> : <div className="safety-note">ID + photo verified · safety first.</div>}
        <p className="spots-row">{spots ? `${spots} spot open · confirmation required` : "Buddied up · no spots left"}</p>
        <button className="detail-cta" disabled={!spots} onClick={onJoin}>
          {spots ? "Join this run" : "Buddied up"}
        </button>
      </div>
    </aside>
  );
}

function PostRunSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg open">
      <section className="modal" aria-label="Post a run">
        <button className="modal-close" onClick={onClose} aria-label="Close post form">
          <ChevronDown size={18} />
        </button>
        <p className="modal-eyebrow">Post a run · architecture v0.1</p>
        <h2>
          your run,
          <br />
          <span>your call.</span>
        </h2>
        <div className="form-grid">
          <label>
            Meeting point
            <input placeholder="Helix Bridge, Marina Bay" />
          </label>
          <label>
            Date
            <input type="date" />
          </label>
          <label>
            Time
            <input type="time" />
          </label>
          <label>
            Pace range
            <select defaultValue="5:00-5:30">
              <option>5:00-5:30</option>
              <option>5:30-6:00</option>
              <option>6:00-6:30</option>
            </select>
          </label>
          <label>
            Spots
            <select defaultValue="1">
              <option>1</option>
              <option>2</option>
              <option>3</option>
              <option>4</option>
            </select>
          </label>
          <label className="toggle-row">
            Women only
            <input type="checkbox" />
          </label>
        </div>
        <button className="modal-cta">Post my run</button>
      </section>
    </div>
  );
}

function MyRunsSheet({ runs, onClose }: { runs: Run[]; onClose: () => void }) {
  return (
    <div className="modal-bg open">
      <section className="modal" aria-label="My runs">
        <button className="modal-close" onClick={onClose} aria-label="Close my runs">
          <ChevronDown size={18} />
        </button>
        <p className="modal-eyebrow">Your runs</p>
        <h2>
          my <span>runs.</span>
        </h2>
        {runs.length ? (
          <div className="my-runs-list">
            {runs.map((run) => (
              <article key={run.id} className="my-run-card">
                <strong>{run.locationName}</strong>
                <small>
                  {run.day} · {run.time} · {paceLabel(run)} /km
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No runs yet</strong>
            <span>Runs you post or join will appear here.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="stat">
      <small>{k}</small>
      <strong>
        {v} {s ? <em>{s}</em> : null}
      </strong>
    </div>
  );
}

function LogoMark() {
  return (
    <svg className="logo-icon" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="10" />
      <circle cx="126" cy="55" r="15" fill="currentColor" />
      <circle cx="74" cy="55" r="15" fill="currentColor" />
    </svg>
  );
}
