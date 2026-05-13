import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Upload, Play, Pause, SkipBack, SkipForward, Music2, Volume2, ListMusic, Maximize2, Minimize2, Eye, EyeOff, X, Trash2, Menu, Search, ChevronDown, Heart, Download } from "lucide-react";
import { Visualizer, VisualMode } from "@/components/Visualizer";
import { cn } from "@/lib/utils";
import { get, set } from "idb-keyval";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Track {
  name: string;
  url: string;
  file: File;
  coverArt?: string;
  artist?: string;
}

const Index = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<VisualMode>("bars");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isLoading, setIsLoading] = useState(true);
  const [, force] = useState(0);

  const [showSidebar, setShowSidebar] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const jsmediatagsRef = useRef<any>(null);
  const shouldPlayRef = useRef(false);
  const restoredTimeRef = useRef<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [fractalOverride, setFractalOverride] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [sidebarTab, setSidebarTab] = useState<"all" | "favorites">("all");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Capture install prompt
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    // Detect if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setInstallPrompt(null);
    }
  };

  useEffect(() => {
    // Load previously saved tracks
    const loadSaved = async () => {
      try {
        const savedTracks = await get<Track[]>("music_tracks");
        const savedCurrent = await get<number>("music_current");
        const savedTime = await get<number>("music_time");
        const savedFavs = await get<string[]>("music_favorites");
        if (savedTracks && savedTracks.length > 0) {
          const revived = savedTracks.map(t => ({
            ...t,
            url: URL.createObjectURL(t.file)
          }));
          if (typeof savedTime === "number" && savedTime > 0) {
            restoredTimeRef.current = savedTime;
          }
          setTracks(revived);
          if (typeof savedCurrent === "number" && savedCurrent < savedTracks.length) {
            setCurrent(savedCurrent);
          }
        }
        if (savedFavs) {
          setFavorites(new Set(savedFavs));
        }
      } catch (err) {
        console.error("Failed to load saved tracks from IndexedDB", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadSaved();

    // Dynamically load jsmediatags
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js";
    script.async = true;
    script.onload = () => {
      jsmediatagsRef.current = (window as any).jsmediatags;
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const ensureCtx = () => {
    if (!audioRef.current) return;
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; // Higher resolution
      analyser.smoothingTimeConstant = 0.85;
      const src = ctx.createMediaElementSource(audioRef.current);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = src;
      force((n) => n + 1);
    }
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
  };

  const getMetadata = (file: File): Promise<{ coverArt?: string, artist?: string, title?: string }> => {
    return new Promise((resolve) => {
      if (!jsmediatagsRef.current) {
        resolve({});
        return;
      }
      jsmediatagsRef.current.read(file, {
        onSuccess: function (tag: any) {
          let coverArt;
          if (tag.tags.picture) {
            const { data, format } = tag.tags.picture;
            let base64String = "";
            for (let i = 0; i < data.length; i++) {
              base64String += String.fromCharCode(data[i]);
            }
            coverArt = `data:${format};base64,${window.btoa(base64String)}`;
          }
          resolve({ coverArt, artist: tag.tags.artist, title: tag.tags.title });
        },
        onError: function (error) {
          resolve({});
        }
      });
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("audio"));
    if (!newFiles.length) return;

    const next: Track[] = await Promise.all(
      newFiles.map(async (f) => {
        const metadata = await getMetadata(f);
        return {
          name: metadata.title || f.name.replace(/\.[^/.]+$/, ""),
          url: URL.createObjectURL(f),
          file: f,
          coverArt: metadata.coverArt,
          artist: metadata.artist || "Desconocido"
        };
      })
    );

    setTracks((prev) => {
      const updated = [...prev, ...next];
      set("music_tracks", updated.map(t => ({ ...t, url: "" })));
      return updated;
    });
    if (tracks.length === 0) {
      setCurrent(0);
      set("music_current", 0);
    }
  };

  const clearPlaylist = async () => {
    setTracks([]);
    setCurrent(0);
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
    await set("music_tracks", []);
  };

  const toggleFavorite = (trackName: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(trackName)) {
        next.delete(trackName);
      } else {
        next.add(trackName);
      }
      set("music_favorites", Array.from(next));
      return next;
    });
  };

  const togglePlay = () => {
    if (!audioRef.current || !tracks.length) return;
    ensureCtx();
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
  };

  const skip = (dir: number) => {
    if (!tracks.length) return;
    shouldPlayRef.current = true; // always play after skip
    restoredTimeRef.current = 0; // don't restore old position on a new track
    set("music_time", 0);
    setCurrent((c) => (c + dir + tracks.length) % tracks.length);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!audioRef.current || !tracks[current]) return;
    audioRef.current.src = tracks[current].url;
    setProgress(0);
    setDuration(0);

    // After metadata loads, seek to the saved position (only on first restore)
    const handleMetadata = () => {
      if (restoredTimeRef.current > 0 && audioRef.current) {
        audioRef.current.currentTime = restoredTimeRef.current;
        setProgress(restoredTimeRef.current);
        restoredTimeRef.current = 0; // Clear so subsequent track changes don't seek
      }
    };
    audioRef.current.addEventListener("loadedmetadata", handleMetadata, { once: true });

    // Use shouldPlayRef OR current playing state to decide whether to play
    if (playing || shouldPlayRef.current) {
      shouldPlayRef.current = false;
      ensureCtx();
      audioRef.current.play().catch(e => console.log("Autoplay prevented", e));
    }

    return () => {
      audioRef.current?.removeEventListener("loadedmetadata", handleMetadata);
    };
  }, [current, tracks]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Persist the current track index so it survives page reload
  useEffect(() => {
    set("music_current", current);
  }, [current]);

  const currentTrack = tracks[current];

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
        <div className="animate-pulse flex flex-col items-center">
          <Music2 className="w-12 h-12 text-white/50 mb-4 animate-bounce" />
          <p className="text-white/70 font-medium tracking-widest uppercase">Cargando biblioteca...</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-h-screen w-full overflow-hidden relative flex text-foreground" style={{ background: "var(--gradient-bg)" }}>
      {/* Visualizer canvas */}
      <div className={cn("absolute inset-0 transition-opacity duration-1000 pointer-events-none z-0", showVisualizer ? "opacity-100" : "opacity-0")}>
        <Visualizer analyser={analyserRef.current} mode={mode} playing={playing} fractalOverride={fractalOverride} />
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 flex flex-col flex-1 h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-5 shrink-0 relative z-[60]">
          {/* Left: Branding & Menu - Always Visible */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setShowSidebar(!showSidebar)} className="hover:bg-foreground/10 text-foreground" title="Abrir Menú">
              <Menu className="w-6 h-6" />
            </Button>
            <img 
              src="/Icon-192.png" 
              alt="Sonitus Logo" 
              className="w-10 h-10 rounded-xl shadow-lg object-cover" 
            />
            <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md">SONITUS</h1>
          </div>

          {/* Right: Controls - Conditional Visibility */}
          <div className="flex items-center gap-4">
            {/* PWA Install Button */}
            {installPrompt && !isInstalled && (
              <button
                onClick={handleInstall}
                title="Instalar Sonitus como app"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold text-white/90 border border-white/20 bg-white/10 backdrop-blur-sm hover:bg-white/20 hover:border-white/40 transition-all hover:scale-105 shadow-lg"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Instalar</span>
              </button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setShowUI(!showUI)} title={showUI ? "Ocultar Interfaz" : "Mostrar Interfaz"} className="text-foreground/80 hover:text-white z-[70]">
              {showUI ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
            </Button>
            
            <div className={cn(
              "flex items-center gap-4 transition-all duration-500",
              !showUI && "opacity-0 pointer-events-none translate-x-10"
            )}>
              <Button variant="ghost" size="icon" onClick={toggleFullscreen} title="Toggle Fullscreen" className="text-foreground/80 hover:text-white hidden sm:flex">
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </Button>
              {/* Desktop mode selector */}
              <div className="hidden sm:flex gap-1 rounded-full border border-foreground/20 backdrop-blur-md bg-background/50 p-1">
                {(["bars", "circle", "wave", "particles", "universe", "psycho", "arc3d", "fractal"] as VisualMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setShowVisualizer(true);
                    }}
                    className={cn(
                      "px-4 py-1.5 text-xs uppercase tracking-widest rounded-full transition-all",
                      mode === m && showVisualizer
                        ? "text-white font-semibold shadow-lg"
                        : "text-foreground/70 hover:text-white hover:bg-foreground/10"
                    )}
                    style={mode === m && showVisualizer ? { background: "var(--gradient-neon)" } : {}}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {/* Mobile mode selector (Dropdown) */}
              <div className="sm:hidden flex items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-9 px-3 text-xs uppercase tracking-widest border-foreground/20 bg-background/50 backdrop-blur-md">
                      {mode} <ChevronDown className="ml-2 w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-background/90 backdrop-blur-lg border-foreground/10 text-foreground">
                    {(["bars", "circle", "wave", "particles", "universe", "psycho", "arc3d", "fractal"] as VisualMode[]).map((m) => (
                      <DropdownMenuItem
                        key={m}
                        onClick={() => {
                          setMode(m);
                          setShowVisualizer(true);
                        }}
                        className={cn(
                          "uppercase text-xs tracking-widest cursor-pointer",
                          mode === m && "text-primary font-bold"
                        )}
                      >
                        {m}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        {/* Empty space for visualizer */}
        <div className="flex-1 pointer-events-none" />

        {/* Fractal Selector Panel - Fixed at top */}
        {mode === "fractal" && (
          <div className={cn(
            "fixed top-[88px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-[100] pointer-events-none transition-all duration-500",
            !showUI && "opacity-0 -translate-y-10"
          )}>
            <div className="flex gap-1 p-1.5 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-full pointer-events-auto shadow-2xl ring-1 ring-white/5">
              <button
                onClick={() => setFractalOverride(null)}
                className={cn(
                  "px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all duration-300",
                  fractalOverride === null 
                    ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-105" 
                    : "text-white/50 hover:text-white hover:bg-white/10"
                )}
              >
                Auto
              </button>
              <div className="w-[1px] h-4 bg-white/10 self-center mx-1" />
              {Array.from({ length: 8 }, (_, idx) => (
                <button
                  key={idx}
                  onClick={() => setFractalOverride(idx)}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center text-[11px] font-bold rounded-full transition-all duration-300 border",
                    fractalOverride === idx 
                      ? "bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-110 z-10" 
                      : "text-white/50 hover:text-white hover:bg-white/10 border-transparent hover:border-white/10"
                  )}
                  title={`Fractal ${idx + 1}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <p className="text-[9px] uppercase tracking-[0.2em] text-white/30 font-medium">Selector de Fractales</p>
          </div>
        )}

        {/* Mobile Fullscreen Toggle */}
        <div className="sm:hidden w-full flex justify-end px-6 pb-4 shrink-0 z-20 pointer-events-none">
          <Button
            variant="outline"
            size="icon"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="rounded-full w-10 h-10 bg-background/50 backdrop-blur-md border-foreground/20 text-foreground shadow-lg pointer-events-auto hover:bg-background/80"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </Button>
        </div>

        {/* Bottom panel */}
        <div className={cn(
          "px-6 pb-6 shrink-0 z-10 transition-all duration-500",
          (isFullscreen || !showUI) ? "opacity-0 pointer-events-none translate-y-10" : "opacity-100 block"
        )}>
          <div className="mx-auto max-w-4xl rounded-2xl border border-foreground/10 backdrop-blur-xl bg-background/40 p-5 shadow-2xl">
            {tracks.length === 0 ? (
              <label className="flex flex-col items-center justify-center gap-3 py-10 cursor-pointer rounded-xl border border-dashed border-foreground/20 hover:border-foreground/40 transition">
                <Upload className="w-8 h-8 text-foreground/60" />
                <div className="text-center">
                  <p className="font-medium text-foreground">Sube tu música local o carpeta</p>
                  <p className="text-sm text-foreground/60 mt-1">MP3, WAV, FLAC, OGG…</p>
                </div>
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  // @ts-ignore
                  webkitdirectory="true"
                  directory="true"
                  className="hidden"
                  onChange={(e) => onFiles(e.target.files)}
                />
              </label>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0 flex items-center gap-3">
                    {currentTrack?.coverArt ? (
                      <img src={currentTrack.coverArt} className="w-10 h-10 rounded-md object-cover border border-foreground/10 shadow-sm" alt="" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-foreground/5 flex items-center justify-center border border-foreground/10">
                        <Music2 className="w-5 h-5 text-foreground/50" />
                      </div>
                    )}
                    <div>
                      <p className="text-xs uppercase tracking-widest text-foreground/50 font-semibold mb-1">Reproduciendo</p>
                      <p className="font-bold text-foreground text-sm truncate w-48 md:w-64 lg:w-96">{currentTrack?.name}</p>
                    </div>
                    {currentTrack && (
                      <button
                        onClick={() => toggleFavorite(currentTrack.name)}
                        className="ml-1 p-1.5 rounded-full transition-all hover:scale-110"
                        title={favorites.has(currentTrack.name) ? "Quitar de favoritos" : "Añadir a favoritos"}
                      >
                        <Heart
                          className="w-5 h-5 transition-all"
                          style={favorites.has(currentTrack.name)
                            ? { fill: "#f43f5e", stroke: "#f43f5e", filter: "drop-shadow(0 0 6px #f43f5e99)" }
                            : { stroke: "rgba(255,255,255,0.4)" }
                          }
                        />
                      </button>
                    )}
                  </div>
                  <label className="text-xs font-medium cursor-pointer text-foreground/70 hover:text-foreground flex items-center gap-1.5 transition">
                    <Upload className="w-4 h-4" /> Añadir
                    <input
                      type="file"
                      accept="audio/*"
                      multiple
                      // @ts-ignore
                      webkitdirectory="true"
                      directory="true"
                      className="hidden"
                      onChange={(e) => onFiles(e.target.files)}
                    />
                  </label>
                </div>

                {/* Progress */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs tabular-nums text-foreground/60 w-10 text-right">
                    {fmt(progress)}
                  </span>
                  <Slider
                    value={[progress]}
                    max={duration || 1}
                    step={0.1}
                    onValueChange={(v) => {
                      if (audioRef.current) audioRef.current.currentTime = v[0];
                    }}
                    className="flex-1 cursor-pointer"
                  />
                  <span className="text-xs tabular-nums text-foreground/60 w-10">
                    {fmt(duration)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 w-32 md:w-40 hidden sm:flex">
                    <Volume2 className="w-4 h-4 text-foreground/60" />
                    <Slider
                      value={[volume * 100]}
                      max={100}
                      onValueChange={(v) => setVolume(v[0] / 100)}
                      className="cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2 mx-auto sm:mx-0">
                    <Button variant="ghost" size="icon" onClick={() => skip(-1)} className="text-foreground/80 hover:text-foreground">
                      <SkipBack className="w-5 h-5" />
                    </Button>
                    <Button
                      size="icon"
                      onClick={togglePlay}
                      className="w-14 h-14 rounded-full border-0 shadow-xl hover:scale-105 transition-transform"
                      style={{ background: "var(--gradient-neon)", boxShadow: "var(--shadow-glow)" }}
                    >
                      {playing ? <Pause className="w-6 h-6 text-white" /> : <Play className="w-6 h-6 ml-0.5 text-white" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => skip(1)} className="text-foreground/80 hover:text-foreground">
                      <SkipForward className="w-5 h-5" />
                    </Button>
                  </div>

                  <div className="w-32 md:w-40 text-right text-xs text-foreground/60 tabular-nums hidden sm:block">
                    {current + 1} / {tracks.length}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Playlist Sidebar */}
      <div
        className={cn(
          "fixed top-0 bottom-0 left-0 w-72 bg-background/90 backdrop-blur-2xl border-r border-foreground/10 z-50 transition-transform duration-300 flex flex-col shadow-2xl",
          showSidebar ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Sidebar header: row 1 = SONITUS brand, row 2 = Playlist + toggle */}
        <div className="border-b border-foreground/10 shrink-0">
          {/* Row 1 — brand (same height as main header) */}
          <div className="h-[76px] flex items-center gap-3 px-5">
            <img 
              src="/Icon-192.png" 
              alt="Sonitus Logo" 
              className="w-10 h-10 rounded-xl shadow-lg object-cover shrink-0" 
            />
            <span className="text-xl font-bold tracking-tight text-white drop-shadow-md">SONITUS</span>
          </div>
          {/* Row 2 — Tabs + close button */}
          <div className="flex items-center justify-between px-5 pb-3">
            <div className="flex gap-1 bg-foreground/5 rounded-xl p-1">
              <button
                onClick={() => setSidebarTab("all")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  sidebarTab === "all"
                    ? "bg-foreground/15 text-foreground shadow-sm"
                    : "text-foreground/50 hover:text-foreground"
                )}
              >
                <ListMusic className="w-3.5 h-3.5" />
                Todo
                <span className="text-[10px] text-foreground/40">{tracks.length}</span>
              </button>
              <button
                onClick={() => setSidebarTab("favorites")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  sidebarTab === "favorites"
                    ? "bg-rose-500/20 text-rose-400 shadow-sm"
                    : "text-foreground/50 hover:text-foreground"
                )}
              >
                <Heart className={cn("w-3.5 h-3.5", sidebarTab === "favorites" && "fill-rose-400")} />
                Favoritos
                <span className="text-[10px] text-foreground/40">{favorites.size}</span>
              </button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSidebar(false)}
              className="hover:bg-foreground/10 text-foreground"
              title="Cerrar menú"
            >
              <Menu className="w-5 h-5" />
            </Button>
          </div>
        </div>
        {/* Search bar */}
        <div className="px-4 pb-3 pt-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar canción o artista..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-foreground/5 border border-foreground/10 rounded-xl pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-foreground/30 focus:bg-foreground/10 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 pt-0 space-y-2">
          {(() => {
            const q = searchQuery.trim().toLowerCase();
            const base = sidebarTab === "favorites"
              ? tracks.filter(t => favorites.has(t.name))
              : tracks;
            const filtered = q
              ? base.filter(t =>
                t.name.toLowerCase().includes(q) ||
                (t.artist ?? "").toLowerCase().includes(q)
              )
              : base;
            return (<>
              {filtered.length === 0 && q && (
                <div className="text-center text-foreground/40 mt-8 text-sm">
                  <Search className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  No se encontraron resultados
                </div>
              )}
              {filtered.length === 0 && !q && sidebarTab === "favorites" && (
                <div className="text-center text-foreground/40 mt-10 px-4">
                  <Heart className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">Sin favoritos aún</p>
                  <p className="text-xs mt-1 opacity-70">Toca el corazón en una canción para añadirla.</p>
                </div>
              )}
              {filtered.map((t) => {
                const i = tracks.indexOf(t);
                const isFav = favorites.has(t.name);
                return (
                  <div
                    key={i}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left group",
                      i === current
                        ? "bg-foreground/10 shadow-md border border-foreground/20"
                        : "hover:bg-foreground/5 border border-transparent"
                    )}
                  >
                    <button
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      onClick={() => {
                        shouldPlayRef.current = true;
                        restoredTimeRef.current = 0;
                        set("music_time", 0);
                        setCurrent(i);
                      }}
                    >
                      {t.coverArt ? (
                        <img src={t.coverArt} className="w-10 h-10 rounded-md object-cover shadow-sm border border-foreground/10 shrink-0" alt="" />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-foreground/5 flex items-center justify-center border border-foreground/10 shrink-0">
                          <Music2 className="w-4 h-4 text-foreground/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-medium text-sm truncate", i === current ? "text-foreground" : "text-foreground/80 group-hover:text-foreground")}>
                          {t.name}
                        </p>
                        <p className="text-xs text-foreground/50 truncate">{t.artist}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {i === current && playing && (
                        <div className="w-4 h-4 flex items-end justify-between gap-[2px] mr-1">
                          <div className="w-1 animate-[bounce_1s_infinite] rounded-full h-full" style={{ backgroundColor: "hsl(190,100%,55%)" }}></div>
                          <div className="w-1 animate-[bounce_1s_infinite_0.2s] rounded-full h-3/4" style={{ backgroundColor: "hsl(270,100%,65%)" }}></div>
                          <div className="w-1 animate-[bounce_1s_infinite_0.4s] rounded-full h-full" style={{ backgroundColor: "hsl(320,100%,60%)" }}></div>
                        </div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(t.name); }}
                        className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:scale-110"
                        title={isFav ? "Quitar de favoritos" : "Añadir a favoritos"}
                      >
                        <Heart
                          className="w-4 h-4 transition-all"
                          style={isFav
                            ? { fill: "#f43f5e", stroke: "#f43f5e", opacity: 1, filter: "drop-shadow(0 0 4px #f43f5e99)" }
                            : { stroke: "rgba(255,255,255,0.5)" }
                          }
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
              {tracks.length === 0 && sidebarTab === "all" && (
                <div className="text-center text-foreground/40 mt-10">
                  <p>No hay canciones.</p>
                  <p className="text-sm">Añade algunas para empezar.</p>
                </div>
              )}
            </>);
          })()}
        </div>
      </div>

      {/* Overlay to close sidebar on mobile/when open */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowSidebar(false)}
        />
      )}

      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => skip(1)}
        onTimeUpdate={(e) => {
          const t = (e.target as HTMLAudioElement).currentTime;
          setProgress(t);
          // Persist current time every ~5 seconds to avoid excessive writes
          if (Math.round(t) % 5 === 0) {
            set("music_time", t);
          }
        }}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        crossOrigin="anonymous"
      />
    </div>
  );
};

const fmt = (s: number) => {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

export default Index;
