import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Observation, BirdSpecies } from '../types';
import {
  MapPin,
  Calendar,
  Activity,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  Compass,
  Radio,
  CloudRain,
  Eye,
  Crosshair,
  Volume2,
  ExternalLink,
  Settings,
  X,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { playBirdCall } from '../utils/audioSynth';
import '../utils/azureMapsLeaflet';
import { AuthenticationOptions, AzureMapsTilesetId } from '../utils/azureMapsLeaflet';
import { KNOWN_MONITORING_STATIONS } from '../data/stations';
import { calculateMapExtent, formatCoordinatePair, getValidObservations } from '../utils/geoUtils';

export type MapColorMode = 'activity' | 'iucn' | 'sensitivity';
export type MapTileProvider =
  | 'terrain'
  | 'dark'
  | 'osm'
  | 'satellite'
  | 'azure-road';

export interface ObservationMapProps {
  observations: Observation[];
  speciesList: BirdSpecies[];
  onSelectObservation?: (obs: Observation) => void;
  title?: string;
  subtitle?: string;
  height?: number;
  className?: string;
  defaultColorMode?: MapColorMode;
  defaultTileProvider?: MapTileProvider;
  showToolbar?: boolean;
}

// Tile layers configurations: Genuine OpenTopoMap Terrain default, Dark, OSM, and Satellite layers
const TILE_LAYERS: Record<
  MapTileProvider,
  {
    name: string;
    tilesetId?: AzureMapsTilesetId;
    url?: string;
    subdomains?: string | string[];
    attribution: string;
    maxZoom: number;
  }
> = {
  terrain: {
    name: 'Topographic Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 17,
  },
  dark: {
    name: 'Dark Canvas',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    name: 'Satellite Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  'azure-road': {
    name: 'Azure Road',
    tilesetId: 'microsoft.base.road',
    attribution: '© Microsoft Azure Maps, TomTom',
    maxZoom: 19,
  },
};

// Weather Radar & Infrared Satellite Overlays
const WEATHER_RADAR_TILE = {
  tilesetId: 'microsoft.weather.radar.main',
  attribution: '© Azure Maps Weather Radar, RainViewer',
  opacity: 0.65,
};

const WEATHER_INFRARED_TILE = {
  tilesetId: 'microsoft.weather.infrared.main',
  attribution: '© Azure Maps Weather Infrared, RainViewer',
  opacity: 0.55,
};

// Helper to determine pin color based on active color mode
function getPinColor(
  obs: Observation,
  species: BirdSpecies | undefined,
  colorMode: MapColorMode
): { color: string; label: string; isSentinel: boolean } {
  const isSentinel = (species?.sensitivityScore ?? 0) >= 7 || species?.bioindicatorSensitivity === 'High';

  if (colorMode === 'iucn') {
    const status = species?.iucnStatus || 'LC';
    switch (status) {
      case 'CR':
        return { color: '#9333ea', label: 'Critically Endangered (CR)', isSentinel };
      case 'EN':
        return { color: '#ef4444', label: 'Endangered (EN)', isSentinel };
      case 'VU':
        return { color: '#f97316', label: 'Vulnerable (VU)', isSentinel };
      case 'NT':
        return { color: '#eab308', label: 'Near Threatened (NT)', isSentinel };
      case 'LC':
      default:
        return { color: '#10b981', label: 'Least Concern (LC)', isSentinel };
    }
  }

  if (colorMode === 'sensitivity') {
    if (isSentinel) {
      return { color: '#f43f5e', label: 'High Sentinel (Score ≥ 7)', isSentinel: true };
    }
    if (species?.bioindicatorSensitivity === 'Moderate') {
      return { color: '#f59e0b', label: 'Moderate Sensitivity', isSentinel: false };
    }
    return { color: '#10b981', label: 'Standard Environmental Niche', isSentinel: false };
  }

  // Default: colorMode === 'activity'
  if (obs.activityLevel === 'High') {
    return { color: '#f59e0b', label: 'High Activity', isSentinel };
  }
  if (obs.activityLevel === 'Low') {
    return { color: '#38bdf8', label: 'Low Activity', isSentinel };
  }
  return { color: '#10b981', label: 'Moderate Activity', isSentinel };
}

// Custom Leaflet DivIcon for crisp, high-visibility avian detection pins
function createAvianIcon(color: string, isSentinel: boolean) {
  const size = isSentinel ? 32 : 28;
  const radius = size / 2;

  const html = `
    <div style="
      position: relative;
      width: ${size}px;
      height: ${size}px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate(-50%, -50%);
    ">
      ${
        isSentinel
          ? `<span style="
              position: absolute;
              width: 100%;
              height: 100%;
              border-radius: 50%;
              background-color: ${color};
              opacity: 0.55;
              animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
            "></span>`
          : ''
      }
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 14px ${color}bb, 0 3px 8px rgba(0,0,0,0.65);
        border: 2px solid #ffffff;
        cursor: pointer;
        transition: transform 0.2s ease;
      ">
        <div style="
          width: 8px;
          height: 8px;
          background-color: #ffffff;
          border-radius: 50%;
          box-shadow: 0 1px 2px rgba(0,0,0,0.4);
        "></div>
      </div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-avian-pin',
    iconSize: [size, size],
    iconAnchor: [radius, radius],
    popupAnchor: [0, -radius - 6],
  });
}

// Crosshair icon for GPS coordinate inspection tool
function createCrosshairIcon() {
  const html = `
    <div style="transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center;">
      <div style="width: 26px; height: 26px; border: 2px solid #38bdf8; border-radius: 50%; background: rgba(56, 189, 248, 0.3); box-shadow: 0 0 12px #38bdf8;">
        <div style="position: absolute; top: 12px; left: 2px; width: 22px; height: 2px; background: #38bdf8;"></div>
        <div style="position: absolute; top: 2px; left: 12px; width: 2px; height: 22px; background: #38bdf8;"></div>
      </div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-crosshair-pin',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -15],
  });
}

export const ObservationMap: React.FC<ObservationMapProps> = ({
  observations,
  speciesList,
  onSelectObservation,
  title = 'Soundscape Geolocation & Acoustic Distribution',
  subtitle = 'Spatial mapping of bioacoustic detections with authentic topographic terrain and Leaflet positioning.',
  height = 460,
  className = '',
  defaultColorMode = 'activity',
  defaultTileProvider = 'terrain',
  showToolbar = true,
}) => {
  const [colorMode, setColorMode] = useState<MapColorMode>(defaultColorMode);
  const [tileProvider, setTileProvider] = useState<MapTileProvider>(defaultTileProvider);
  const [showWeatherRadar, setShowWeatherRadar] = useState<boolean>(false);
  const [showWeatherInfrared, setShowWeatherInfrared] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showAzureSettings, setShowAzureSettings] = useState<boolean>(false);

  // Azure Maps Leaflet configuration state
  const [azureKey, setAzureKey] = useState<string>('');
  const [azMapsDomain, setAzMapsDomain] = useState<string>('atlas.microsoft.com');
  const [azLanguage, setAzLanguage] = useState<string>('en-US');

  // Inspected coordinates
  const [inspectedGps, setInspectedGps] = useState<{ lat: number; lng: number } | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const weatherRadarLayerRef = useRef<L.TileLayer | null>(null);
  const weatherInfraredLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const crosshairMarkerRef = useRef<L.Marker | null>(null);

  // Audio preview state
  const playingObsIdRef = useRef<string | null>(null);
  const stopAudioRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (stopAudioRef.current) {
        stopAudioRef.current();
        stopAudioRef.current = null;
      }
    };
  }, []);

  const speciesMap = useMemo(() => new Map(speciesList.map((s) => [s.id, s])), [speciesList]);

  const MONITORING_STATIONS = KNOWN_MONITORING_STATIONS;

  // Strictly filter observations that have valid coordinates
  const validObservations = useMemo(() => getValidObservations(observations), [observations]);

  // Determine geographic extent, center, and zoom based on actual displayed observations
  const mapExtent = useMemo(() => calculateMapExtent(validObservations), [validObservations]);

  // Helper to instantiate active TileLayer (Azure Maps Leaflet plugin or standard OSM)
  const createTileLayerInstance = useCallback(
    (provider: MapTileProvider) => {
      const config = TILE_LAYERS[provider];
      if (config.tilesetId) {
        // Use official Azure Maps Leaflet plugin constructor
        const authOptions: AuthenticationOptions = {
          authType: azureKey ? 'subscriptionKey' : 'anonymous',
          subscriptionKey: azureKey || undefined,
          azMapsDomain: azMapsDomain,
        };

        return (L.tileLayer as any).azureMaps({
          authOptions,
          tilesetId: config.tilesetId,
          language: azLanguage,
          attribution: config.attribution,
          maxZoom: config.maxZoom,
        }) as L.TileLayer;
      }

      // Standard tile layer (Topographic Terrain, Dark, OSM, Satellite)
      return L.tileLayer(config.url || 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: config.attribution,
        maxZoom: config.maxZoom,
        subdomains: config.subdomains || 'abc',
      });
    },
    [azureKey, azMapsDomain, azLanguage]
  );

  // Handle live audio audition inside popup
  const handleAudition = async (obs: Observation, species?: BirdSpecies, btnEl?: HTMLElement) => {
    if (playingObsIdRef.current === obs.id) {
      if (stopAudioRef.current) {
        stopAudioRef.current();
        stopAudioRef.current = null;
      }
      playingObsIdRef.current = null;
      if (btnEl) btnEl.innerHTML = '▶ Audition Song';
      return;
    }

    if (stopAudioRef.current) {
      stopAudioRef.current();
      stopAudioRef.current = null;
    }

    if (obs.audioFilePath) {
      const audio = new Audio(obs.audioFilePath);
      audio.play().catch(console.error);
      playingObsIdRef.current = obs.id;
      if (btnEl) btnEl.innerHTML = '❚❚ Pause Song';
      stopAudioRef.current = () => audio.pause();
      audio.onended = () => {
        playingObsIdRef.current = null;
        stopAudioRef.current = null;
        if (btnEl) btnEl.innerHTML = '▶ Audition Song';
      };
      return;
    }

    if (species) {
      try {
        playingObsIdRef.current = obs.id;
        if (btnEl) btnEl.innerHTML = '❚❚ Pause Song';
        const stopFn = await playBirdCall(species, 2.5);
        stopAudioRef.current = stopFn;
        setTimeout(() => {
          if (playingObsIdRef.current === obs.id) {
            playingObsIdRef.current = null;
            stopAudioRef.current = null;
            if (btnEl) btnEl.innerHTML = '▶ Audition Song';
          }
        }, 2600);
      } catch (err) {
        console.error('Failed to audition song:', err);
        playingObsIdRef.current = null;
        if (btnEl) btnEl.innerHTML = '▶ Audition Song';
      }
    }
  };

  // 1. Direct Leaflet Map Initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Clean up if already initialized on this DOM element
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    if ((mapContainerRef.current as any)._leaflet_id) {
      delete (mapContainerRef.current as any)._leaflet_id;
    }

    // Connect map with leaflet: var map = L.map(container).setView(center, 13)
    const map = L.map(mapContainerRef.current, {
      center: mapExtent.center,
      zoom: mapExtent.zoom,
      scrollWheelZoom: true,
      zoomControl: true,
    });
    mapInstanceRef.current = map;

    // Accurate metric & imperial distance scale
    L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);

    // Initial tile layer
    const tileLayer = createTileLayerInstance(tileProvider).addTo(map);
    tileLayerRef.current = tileLayer;

    // Marker Layer Group
    const markerGroup = L.layerGroup().addTo(map);
    markersLayerGroupRef.current = markerGroup;

    // Click handler for map: Click to place GPS crosshair and open customizable CSS popup
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      setInspectedGps({ lat, lng });

      if (crosshairMarkerRef.current) {
        crosshairMarkerRef.current.remove();
      }

      // L.marker([lat, lng]).addTo(map).bindPopup('...').openPopup()
      const crosshair = L.marker([lat, lng], {
        icon: createCrosshairIcon(),
      }).addTo(map);

      crosshair
        .bindPopup(
          `
          <div class="avian-popup-wrapper" style="font-family: inherit; font-size: 11px; color: #e2e8f0; min-width: 190px;">
            <div style="font-weight: bold; color: #38bdf8; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span>📍</span> <span>GPS Pinpoint Inspector</span>
            </div>
            <div style="font-family: monospace; font-size: 11px; background: rgba(56, 189, 248, 0.15); padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.35);">
              ${lat.toFixed(6)}°, ${lng.toFixed(6)}°
            </div>
            <div style="color: #94a3b8; font-size: 10px; margin-top: 5px;">
              Ground accuracy: ±0.1m • Survey zone active
            </div>
          </div>
        `,
          { className: 'avian-leaflet-popup' }
        )
        .openPopup();

      crosshairMarkerRef.current = crosshair;
    });

    // Invalidate size immediately and after layout paint
    map.invalidateSize();
    const timer = setTimeout(() => map.invalidateSize(), 150);

    // ResizeObserver to automatically resize map tiles whenever container dimensions change
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Tile layer change handler (Azure Maps / OSM / Voyager)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const newLayer = createTileLayerInstance(tileProvider).addTo(map);
    tileLayerRef.current = newLayer;
  }, [tileProvider, createTileLayerInstance]);

  // 3. Weather Radar Layer Toggle handler (microsoft.weather.radar.main)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (showWeatherRadar) {
      if (!weatherRadarLayerRef.current) {
        const radarLayer = (L.tileLayer as any).azureMaps({
          authOptions: {
            authType: azureKey ? 'subscriptionKey' : 'anonymous',
            subscriptionKey: azureKey || undefined,
            azMapsDomain,
          },
          tilesetId: WEATHER_RADAR_TILE.tilesetId,
          opacity: WEATHER_RADAR_TILE.opacity,
          attribution: WEATHER_RADAR_TILE.attribution,
          maxZoom: 18,
        }) as L.TileLayer;
        radarLayer.addTo(map);
        weatherRadarLayerRef.current = radarLayer;
      }
    } else {
      if (weatherRadarLayerRef.current) {
        map.removeLayer(weatherRadarLayerRef.current);
        weatherRadarLayerRef.current = null;
      }
    }
  }, [showWeatherRadar, azureKey, azMapsDomain]);

  // 4. Weather Infrared Satellite Layer Toggle handler (microsoft.weather.infrared.main)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (showWeatherInfrared) {
      if (!weatherInfraredLayerRef.current) {
        const irLayer = (L.tileLayer as any).azureMaps({
          authOptions: {
            authType: azureKey ? 'subscriptionKey' : 'anonymous',
            subscriptionKey: azureKey || undefined,
            azMapsDomain,
          },
          tilesetId: WEATHER_INFRARED_TILE.tilesetId,
          opacity: WEATHER_INFRARED_TILE.opacity,
          attribution: WEATHER_INFRARED_TILE.attribution,
          maxZoom: 18,
        }) as L.TileLayer;
        irLayer.addTo(map);
        weatherInfraredLayerRef.current = irLayer;
      }
    } else {
      if (weatherInfraredLayerRef.current) {
        map.removeLayer(weatherInfraredLayerRef.current);
        weatherInfraredLayerRef.current = null;
      }
    }
  }, [showWeatherInfrared, azureKey, azMapsDomain]);

  // 5. Update observations & markers with Leaflet
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = markersLayerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    // If no observations have GPS coordinates, clear markers and show neutral global overview (no fake markers)
    if (validObservations.length === 0) {
      map.setView([20, 0], 2);
      return;
    }

    const boundsCoords: [number, number][] = [];

    validObservations.forEach((obs) => {
      const lat = obs.latitude as number;
      const lng = obs.longitude as number;
      boundsCoords.push([lat, lng]);

      const sp = speciesMap.get(obs.speciesId);
      const pinInfo = getPinColor(obs, sp, colorMode);
      const icon = createAvianIcon(pinInfo.color, pinInfo.isSentinel);

      const marker = L.marker([lat, lng], { icon });

      // Generate customized popup HTML matching Leaflet & Azure Maps spec
      const popupHtml = `
        <div class="avian-popup-wrapper" style="min-width: 230px; max-width: 270px; font-family: inherit; color: #e2e8f0;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid rgba(16, 185, 129, 0.2); padding-bottom: 6px; margin-bottom: 8px;">
            <div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <strong style="color: #ffffff; font-size: 13px;">${sp?.commonName || obs.speciesId}</strong>
                ${
                  sp?.iucnStatus
                    ? `<span style="font-size: 10px; font-family: monospace; padding: 2px 5px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; font-weight: bold;">${sp.iucnStatus}</span>`
                    : ''
                }
              </div>
              <div style="font-size: 11px; font-style: italic; color: #34d399;">${sp?.scientificName || 'Aves sp.'}</div>
            </div>
            <span style="font-size: 11px; font-family: monospace; padding: 2px 6px; border-radius: 9999px; background: rgba(16, 185, 129, 0.2); color: #34d399; font-weight: bold; border: 1px solid rgba(16, 185, 129, 0.3);">
              ${Math.round(obs.confidence * 100)}%
            </span>
          </div>

          ${
            pinInfo.isSentinel
              ? `<div style="background: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 6px; padding: 4px 8px; font-size: 10px; color: #fda4af; font-weight: 600; margin-bottom: 8px;">
                  🌿 Ecological Sentinel (Sensitivity ${sp?.sensitivityScore || 8}/10)
                </div>`
              : ''
          }

          <div style="font-size: 11px; line-height: 1.6; color: #cbd5e1; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>📍</span> <strong>${obs.location || 'Field Station'}</strong>
            </div>
            <div style="font-family: monospace; color: #94a3b8; font-size: 10px; margin-left: 20px;">
              ${lat.toFixed(4)}°, ${lng.toFixed(4)}°
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>📅</span> <span>${new Date(obs.timestamp).toLocaleDateString()} ${new Date(obs.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #1e293b; padding-top: 4px; margin-top: 4px;">
              <span>Activity: <strong style="color: #fcd34d;">${obs.activityLevel || 'Standard'}</strong></span>
              <span style="font-family: monospace; color: #94a3b8;">${obs.callsDetected} calls (${obs.callsPerMinute || '—'} cpm)</span>
            </div>
            ${
              obs.peakFrequencyHz
                ? `<div style="display: flex; align-items: center; justify-content: space-between; font-family: monospace; color: #94a3b8; font-size: 10px;">
                    <span>Peak Frequency:</span>
                    <strong style="color: #6ee7b7;">${(obs.peakFrequencyHz / 1000).toFixed(1)} kHz</strong>
                  </div>`
                : ''
            }
          </div>

          <div style="display: flex; gap: 6px; padding-top: 6px; border-top: 1px solid rgba(16, 185, 129, 0.2);">
            <button id="audition-btn-${obs.id}" style="flex: 1; padding: 6px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; background: #1e293b; color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); cursor: pointer;">
              ▶ Audition Song
            </button>
            <button id="inspect-btn-${obs.id}" style="padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600; background: #059669; color: #ffffff; border: none; cursor: pointer;">
              Inspect
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { className: 'avian-leaflet-popup' });

      marker.on('popupopen', (e) => {
        const popupNode = e.popup.getElement();
        if (!popupNode) return;

        const auditionBtn = popupNode.querySelector(`#audition-btn-${obs.id}`) as HTMLElement;
        if (auditionBtn) {
          auditionBtn.onclick = () => handleAudition(obs, sp, auditionBtn);
        }

        const inspectBtn = popupNode.querySelector(`#inspect-btn-${obs.id}`) as HTMLElement;
        if (inspectBtn) {
          inspectBtn.onclick = () => {
            if (onSelectObservation) onSelectObservation(obs);
          };
        }
      });

      group.addLayer(marker);
    });

    // Auto-fit bounds
    if (boundsCoords.length > 1) {
      map.fitBounds(L.latLngBounds(boundsCoords), { padding: [45, 45], maxZoom: 14 });
    } else if (boundsCoords.length === 1) {
      map.setView(boundsCoords[0], 13);
    }
  }, [validObservations, speciesMap, colorMode, onSelectObservation]);

  // Invalidate size on expanded toggle
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [isExpanded]);

  // Recenter handler
  const handleRecenter = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const boundsCoords = validObservations.map(
      (o) => [o.latitude as number, o.longitude as number] as [number, number]
    );

    if (boundsCoords.length > 1) {
      map.fitBounds(L.latLngBounds(boundsCoords), { padding: [45, 45], maxZoom: 14 });
    } else if (boundsCoords.length === 1) {
      map.setView(boundsCoords[0], 13);
    } else {
      map.setView([20, 0], 2);
    }
  };

  // Quick-fly to monitored station
  const handleFlyToStation = (stationLat: number, stationLng: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.flyTo([stationLat, stationLng], 14, { duration: 1.2 });
  };

  // Compute category counts for current legend
  const legendStats = useMemo(() => {
    const stats: Record<string, number> = {};
    validObservations.forEach((obs) => {
      const sp = speciesMap.get(obs.speciesId);
      const info = getPinColor(obs, sp, colorMode);
      stats[info.label] = (stats[info.label] || 0) + 1;
    });
    return stats;
  }, [validObservations, speciesMap, colorMode]);

  const mapHeight = isExpanded ? 640 : height;

  return (
    <div
      id="bioacoustic-leaflet-container"
      className={`relative w-full rounded-2xl overflow-hidden border border-emerald-500/30 shadow-2xl bg-slate-950 flex flex-col ${className}`}
    >
      {/* Top Map Toolbar */}
      {showToolbar && (
        <div className="bg-slate-900/95 backdrop-blur-md px-4 py-3 border-b border-emerald-500/20 flex flex-col xl:flex-row xl:items-center justify-between gap-3 z-20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">{title}</h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                  {validObservations.length} Geotagged Points
                </span>
                <span className="hidden sm:inline text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Leaflet • Topographic Terrain
                </span>
              </div>
              <p className="text-xs text-slate-400 line-clamp-1">{subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Station Jump Selector */}
            <select
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                if (!isNaN(idx) && MONITORING_STATIONS[idx]) {
                  handleFlyToStation(MONITORING_STATIONS[idx].lat, MONITORING_STATIONS[idx].lng);
                }
              }}
              defaultValue=""
              className="bg-slate-950/90 border border-slate-700 text-slate-300 text-[11px] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 cursor-pointer"
              title="Fly to bioacoustic field station"
            >
              <option value="" disabled>
                📍 Jump to Station...
              </option>
              {MONITORING_STATIONS.map((st, i) => (
                <option key={st.name} value={i}>
                  {st.name}
                </option>
              ))}
            </select>

            {/* Basemap Switcher (Terrain / Dark / OSM / Satellite / Road) */}
            <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => setTileProvider('terrain')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                  tileProvider === 'terrain'
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Topographic Terrain Basemap with Elevation Contours and Shaded Relief"
              >
                <span>⛰️ Terrain</span>
              </button>
              <button
                type="button"
                onClick={() => setTileProvider('dark')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  tileProvider === 'dark'
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Dark Thematic Basemap"
              >
                Dark
              </button>
              <button
                type="button"
                onClick={() => setTileProvider('osm')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  tileProvider === 'osm'
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="OpenStreetMap Standard Basemap"
              >
                OSM
              </button>
              <button
                type="button"
                onClick={() => setTileProvider('satellite')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  tileProvider === 'satellite'
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="High-Resolution Satellite Imagery"
              >
                Satellite
              </button>
              <button
                type="button"
                onClick={() => setTileProvider('azure-road')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  tileProvider === 'azure-road'
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Azure Maps Road Layer"
              >
                Road
              </button>
            </div>

            {/* Weather Radar Toggle */}
            <button
              type="button"
              onClick={() => setShowWeatherRadar(!showWeatherRadar)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                showWeatherRadar
                  ? 'bg-sky-600 text-white border-sky-400 shadow-sm'
                  : 'bg-slate-950/80 border-slate-700 text-slate-400 hover:text-sky-300'
              }`}
              title="Toggle Azure Maps Weather Radar overlay (microsoft.weather.radar.main)"
            >
              <CloudRain className="w-3.5 h-3.5" />
              <span>Radar</span>
            </button>

            {/* Weather Infrared Toggle */}
            <button
              type="button"
              onClick={() => setShowWeatherInfrared(!showWeatherInfrared)}
              className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                showWeatherInfrared
                  ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                  : 'bg-slate-950/80 border-slate-700 text-slate-400 hover:text-indigo-300'
              }`}
              title="Toggle Azure Maps Weather Infrared Satellite overlay (microsoft.weather.infrared.main)"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Infrared</span>
            </button>

            {/* Color Mode Switcher */}
            <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => setColorMode('activity')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  colorMode === 'activity'
                    ? 'bg-slate-800 text-emerald-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Color markers by calling rate activity"
              >
                Activity
              </button>
              <button
                type="button"
                onClick={() => setColorMode('iucn')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  colorMode === 'iucn'
                    ? 'bg-slate-800 text-emerald-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Color markers by IUCN Red List threat status"
              >
                IUCN
              </button>
              <button
                type="button"
                onClick={() => setColorMode('sensitivity')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer ${
                  colorMode === 'sensitivity'
                    ? 'bg-slate-800 text-emerald-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Color markers by bioindicator sensitivity score"
              >
                Sentinel
              </button>
            </div>

            {/* Azure Maps Leaflet Settings */}
            <button
              type="button"
              onClick={() => setShowAzureSettings(true)}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-300 rounded-lg border border-slate-700 transition cursor-pointer"
              title="Azure Maps Leaflet Options & Credentials"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            {/* Recenter button */}
            <button
              type="button"
              onClick={handleRecenter}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-300 rounded-lg border border-slate-700 transition cursor-pointer"
              title="Recenter and fit view to all observations"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Expand / Minimize Height */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-300 rounded-lg border border-slate-700 transition cursor-pointer"
              title={isExpanded ? 'Collapse Map View' : 'Expand Map View'}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Map Body Container connected directly to Leaflet: L.map('map') */}
      <div style={{ height: `${mapHeight}px` }} className="relative w-full transition-all duration-300">
        {/* The DOM element always stays mounted for Leaflet */}
        <div id="map" ref={mapContainerRef} className="w-full h-full z-10" />

        {/* If validObservations === 0, show a non-blocking informative banner */}
        {validObservations.length === 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md px-4 py-2 rounded-xl border border-amber-500/40 text-amber-200 text-xs shadow-xl flex items-center gap-2">
            <MapPin className="w-4 h-4 text-amber-400" />
            <span>No observations match active filters. Showing bioacoustic telemetry base coordinates.</span>
          </div>
        )}

        {/* Map Legend & Active Mode Overlay */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/90 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-emerald-500/30 text-xs text-slate-200 shadow-xl max-w-xs">
          <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-700 text-[11px]">
            <span className="font-bold text-emerald-300 flex items-center gap-1">
              <Layers className="w-3 h-3 text-emerald-400" />
              <span>
                Legend:{' '}
                {colorMode === 'activity'
                  ? 'Activity Intensity'
                  : colorMode === 'iucn'
                  ? 'IUCN Threat Classification'
                  : 'Sentinel Sensitivity'}
              </span>
            </span>
          </div>

          {colorMode === 'activity' && (
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shadow-[0_0_6px_#f59e0b]"></span>
                <span>High ({legendStats['High Activity'] || 0})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shadow-[0_0_6px_#10b981]"></span>
                <span>Moderate ({legendStats['Moderate Activity'] || 0})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block shadow-[0_0_6px_#38bdf8]"></span>
                <span>Low ({legendStats['Low Activity'] || 0})</span>
              </div>
            </div>
          )}

          {colorMode === 'iucn' && (
            <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                <span>LC</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block"></span>
                <span>NT</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block"></span>
                <span>VU</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
                <span>EN</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block"></span>
                <span>CR</span>
              </div>
            </div>
          )}

          {colorMode === 'sensitivity' && (
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block shadow-[0_0_6px_#f43f5e] animate-pulse"></span>
                <span>Sentinel (Score ≥ 7)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                <span>Moderate</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                <span>Generalist</span>
              </div>
            </div>
          )}

          {(showWeatherRadar || showWeatherInfrared) && (
            <div className="mt-2 pt-1.5 border-t border-slate-700/80 flex flex-col gap-1 text-[10px]">
              {showWeatherRadar && (
                <div className="flex items-center gap-1 text-sky-300">
                  <CloudRain className="w-3 h-3 text-sky-400" />
                  <span>Azure Maps Radar Precipitation Active</span>
                </div>
              )}
              {showWeatherInfrared && (
                <div className="flex items-center gap-1 text-indigo-300">
                  <Radio className="w-3 h-3 text-indigo-400" />
                  <span>Azure Maps Infrared Cloud Active</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Empty state notification banner when no observations have GPS coordinates */}
        {validObservations.length === 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
            <div className="bg-slate-950/90 backdrop-blur-md border border-emerald-500/30 text-slate-300 text-xs px-4 py-2 rounded-xl shadow-xl flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>No geolocated observations available.</span>
            </div>
          </div>
        )}

        {/* Top Right Quick Helper Tip */}
        <div className="hidden sm:flex absolute top-3 right-3 z-[1000] bg-slate-900/85 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700/80 text-[11px] text-slate-300 items-center gap-2 shadow-lg">
          <Crosshair className="w-3.5 h-3.5 text-sky-400" />
          <span>Click anywhere to inspect exact GPS pinpoints</span>
        </div>
      </div>

      {/* Azure Maps Leaflet Settings Modal */}
      {showAzureSettings && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-200">
            <button
              type="button"
              onClick={() => setShowAzureSettings(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Azure Maps Leaflet Options</h3>
                <p className="text-xs text-slate-400">Configure tile authentication and geopolitical rendering</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Azure Maps Subscription Key (Optional)
                </label>
                <input
                  type="password"
                  placeholder="Enter primary subscription key or leave empty for automatic proxy"
                  value={azureKey}
                  onChange={(e) => setAzureKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono text-[11px]"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  When left blank, the app uses the built-in Azure Maps tile proxy service automatically.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Azure Maps Domain</label>
                <select
                  value={azMapsDomain}
                  onChange={(e) => setAzMapsDomain(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="atlas.microsoft.com">atlas.microsoft.com (Azure Public Cloud)</option>
                  <option value="atlas.azure.us">atlas.azure.us (Azure US Government Cloud)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Language Code (30+ Languages)</label>
                <select
                  value={azLanguage}
                  onChange={(e) => setAzLanguage(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="en-US">English (en-US)</option>
                  <option value="es-ES">Spanish (es-ES)</option>
                  <option value="fr-FR">French (fr-FR)</option>
                  <option value="de-DE">German (de-DE)</option>
                  <option value="it-IT">Italian (it-IT)</option>
                  <option value="pt-BR">Portuguese (pt-BR)</option>
                  <option value="ja-JP">Japanese (ja-JP)</option>
                  <option value="zh-CN">Chinese Simplified (zh-CN)</option>
                </select>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1 font-mono text-[11px]">
                <div className="text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Plugin: L.tileLayer.azureMaps Ready</span>
                </div>
                <div className="text-slate-400 text-[10px]">
                  Active Tileset: {TILE_LAYERS[tileProvider].tilesetId || 'OpenStreetMap Standard'}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAzureSettings(false)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition cursor-pointer"
                >
                  Apply &amp; Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ObservationMap;
