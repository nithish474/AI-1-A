import L from 'leaflet';

/**
 * Authentication options for connecting to the Azure Maps tile services.
 * Conforms to the official Azure Maps Leaflet Plugin specification.
 */
export interface AuthenticationOptions {
  authType?: 'subscriptionKey' | 'aad' | 'anonymous';
  subscriptionKey?: string;
  aadAppId?: string;
  aadInstance?: string;
  aadTenant?: string;
  authContext?: any;
  clientId?: string;
  azMapsDomain?: string;
  getToken?: (resolve: (token: string) => void, reject: (err: any) => void, map: L.Map) => void;
}

export type AzureMapsTilesetId =
  | 'microsoft.base.road'
  | 'microsoft.base.labels.road'
  | 'microsoft.base.hybrid.road'
  | 'microsoft.base.darkgrey'
  | 'microsoft.imagery'
  | 'microsoft.traffic.flow.absolute'
  | 'microsoft.traffic.flow.reduced-sensitivity'
  | 'microsoft.traffic.flow.relative'
  | 'microsoft.traffic.flow.relative-delay'
  | 'microsoft.traffic.incident.night'
  | 'microsoft.traffic.incident.s1'
  | 'microsoft.traffic.incident.s2'
  | 'microsoft.traffic.incident.s3'
  | 'microsoft.weather.infrared.main'
  | 'microsoft.weather.radar.main'
  | string;

export interface AzureMapsTileLayerOptions extends L.TileLayerOptions {
  authOptions?: AuthenticationOptions;
  tilesetId?: AzureMapsTilesetId;
  language?: string;
  view?: string;
  timeStamp?: string | Date;
  trafficFlowThickness?: number;
}

/**
 * AzureMaps TileLayer implementation for Leaflet
 * Implements the official Azure Maps Leaflet Plugin class interface.
 */
export class AzureMapsTileLayer extends L.TileLayer {
  private _authOptions: AuthenticationOptions;
  private _tilesetId: string;
  private _language: string;
  private _view: string;
  private _timeStamp?: string | Date;
  private _trafficFlowThickness: number;

  constructor(options?: AzureMapsTileLayerOptions) {
    const opts = options || {};
    const tileset = opts.tilesetId || 'microsoft.base.road';
    const subKey = opts.authOptions?.subscriptionKey || '';
    const domain = opts.authOptions?.azMapsDomain || 'atlas.microsoft.com';

    // Direct Azure Maps API template if subscription key provided, else transparent backend proxy
    let urlTemplate = `/api/maps/azure-tile?tilesetId={tilesetId}&z={z}&x={x}&y={y}&language={language}&view={view}&tileSize=256`;
    if (subKey) {
      urlTemplate = `https://${domain}/map/tile?subscription-key={subscriptionKey}&api-version=2.0&tilesetId={tilesetId}&zoom={z}&x={x}&y={y}&tileSize=256&language={language}&view={view}`;
    }

    const defaultAttribution = `© ${new Date().getFullYear()} Microsoft Azure Maps, TomTom`;
    super(urlTemplate, {
      attribution: opts.attribution || defaultAttribution,
      maxZoom: opts.maxZoom || 19,
      minZoom: opts.minZoom || 1,
      tileSize: opts.tileSize || 256,
      ...opts,
    });

    this._authOptions = opts.authOptions || {};
    this._tilesetId = tileset;
    this._language = opts.language || 'en-US';
    this._view = opts.view || 'Auto';
    this._timeStamp = opts.timeStamp;
    this._trafficFlowThickness = opts.trafficFlowThickness || 5;
  }

  public getAttribution(): string {
    return (this.options.attribution as string) || `© ${new Date().getFullYear()} Microsoft Azure Maps`;
  }

  public getTilesetId(): string {
    return this._tilesetId;
  }

  public setTilesetId(tilesetId: string): this {
    this._tilesetId = tilesetId;
    this.redraw();
    return this;
  }

  public getLanguage(): string {
    return this._language;
  }

  public setLanguage(language: string): this {
    this._language = language;
    this.redraw();
    return this;
  }

  public getView(): string {
    return this._view;
  }

  public setView(view: string): this {
    this._view = view;
    this.redraw();
    return this;
  }

  public getTimeStamp(): string | Date | undefined {
    return this._timeStamp;
  }

  public setTimeStamp(timeStamp: string | Date): this {
    this._timeStamp = timeStamp;
    this.redraw();
    return this;
  }

  public getTrafficFlowThickness(): number {
    return this._trafficFlowThickness;
  }

  public setTrafficFlowThickness(thickness: number): this {
    this._trafficFlowThickness = thickness;
    this.redraw();
    return this;
  }

  public getTileUrl(coords: L.Coords): string {
    const data: Record<string, any> = {
      x: coords.x,
      y: coords.y,
      z: (this as any)._getZoomForUrl ? (this as any)._getZoomForUrl() : (this as any)._map ? (this as any)._map.getZoom() : coords.z,
      tilesetId: this._tilesetId,
      language: this._language,
      view: this._view,
      subscriptionKey: this._authOptions.subscriptionKey || '',
      thickness: this._trafficFlowThickness,
    };

    if (this._timeStamp) {
      const ts =
        this._timeStamp instanceof Date
          ? this._timeStamp.toISOString()
          : String(this._timeStamp);
      data.timeStamp = encodeURIComponent(ts);
    }

    return L.Util.template((this as any)._url, L.Util.extend(data, this.options));
  }
}

// Extend global Leaflet namespace to support:
// 1. L.tileLayer.azureMaps({ authOptions: ... })
// 2. L.tileLayer.AzureMaps({ authOptions: ... })
// 3. new L.TileLayer.AzureMaps({ authOptions: ... })
if (typeof L !== 'undefined') {
  (L.TileLayer as any).AzureMaps = AzureMapsTileLayer;
  (L.tileLayer as any).azureMaps = function (options?: AzureMapsTileLayerOptions) {
    return new AzureMapsTileLayer(options);
  };
  (L.tileLayer as any).AzureMaps = function (options?: AzureMapsTileLayerOptions) {
    return new AzureMapsTileLayer(options);
  };
}

export default AzureMapsTileLayer;
