from flask import Flask, jsonify, render_template, request
import time

app = Flask(__name__)

# Slug -> title mapping for the left menu. Center content is swapped by JS,
# but we also expose clean URLs so refresh / sharing works.
PAGES = {
    "o-nas": "O nás",
    "jednotka": "Jednotka",
    "akce": "Akce sboru",
    "napsali": "Napsali o nás",
    "kontakty": "Kontakty",
    "informace": "Informace pro občany",
    "sponzori": "Sponzoři",
}

# ---------------------------------------------------------------------------
# Events calendar – single source of truth for the right-panel calendar.
# Add / remove events here. Date format: YYYY-MM-DD.
# These are EXAMPLE entries so the calendar has something to show.
# ---------------------------------------------------------------------------
EVENTS = [
    {"date": "2026-10-11", "title": "Drakiáda (příklad)", "place": "hřiště Litvínovice"},
    {"date": "2026-10-28", "title": "Sběr železného šrotu (příklad)", "place": "Litvínovice"},
    {"date": "2026-12-05", "title": "Mikulášská nadílka (příklad)", "place": "hasičská zbrojnice"},
]

# Litvínovice coordinates
LITVINOVICE_LAT = 48.963
LITVINOVICE_LON = 14.447

# CHMI gauging stations relevant for Litvínovice
HYDRO_STATIONS = [
    {"objID": "0-203-1-115100", "dbc": "115100", "name": "České Budějovice", "river": "Vltava"},
    {"objID": "0-203-1-115000", "dbc": "115000", "name": "Roudné", "river": "Malše"},
]

_meta_cache = {"ts": 0, "data": {}}


def _get_spa_limits():
    """Fetch SPA limits from CHMI metadata (cached 24h). Returns {dbc: {...}}."""
    now = time.time()
    if now - _meta_cache["ts"] < 24 * 3600 and _meta_cache["data"]:
        return _meta_cache["data"]
    try:
        import requests

        r = requests.get(
            "https://opendata.chmi.cz/hydrology/now/metadata/meta1.json", timeout=15
        )
        r.raise_for_status()
        vals = r.json()["data"]["data"]["values"]
        out = {}
        for v in vals:
            # values: [objID, DBC, STATION_NAME, STREAM_NAME, GEOGR1, GEOGR2,
            #  SPA_TYP, SPAH_DS, SPAH_UNIT, DRYH, SPA1H, SPA2H, SPA3H, SPA4H, ...]
            try:
                out[str(v[1])] = {
                    "spa1": v[10],
                    "spa2": v[11],
                    "spa3": v[12],
                    "dry": v[9],
                }
            except Exception:
                continue
        _meta_cache.update(ts=now, data=out)
        return out
    except Exception:
        return _meta_cache["data"]


def _fetch_station(obj_id):
    """Fetch today's 10-min series for one station. Returns {H:[...], Q:[...], TH:[...]}."""
    import requests

    url = f"https://opendata.chmi.cz/hydrology/now/data/{obj_id}.json"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    series = {}
    for obj in r.json().get("objList", []):
        for ts in obj.get("tsList", []):
            data = ts.get("tsData") or []
            if data:
                series[ts.get("tsConID")] = data
    return series


@app.get("/")
def index():
    return render_template("index.html", active_page="o-nas", pages=PAGES)


@app.get("/<slug>")
def page(slug):
    if slug in PAGES:
        return render_template("index.html", active_page=slug, pages=PAGES)
    return render_template("index.html", active_page="o-nas", pages=PAGES), 404


@app.get("/api/events")
def api_events():
    evts = sorted(EVENTS, key=lambda e: e.get("date", ""))
    return jsonify({"status": "ok", "events": evts})


@app.get("/api/weather")
def weather():
    lat = request.args.get("lat", default=LITVINOVICE_LAT, type=float)
    lon = request.args.get("lon", default=LITVINOVICE_LON, type=float)

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
        "hourly": "temperature_2m,precipitation_probability,weathercode",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
        "timezone": "auto",
        "forecast_days": 5,
    }

    try:
        import requests

        resp = requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        return jsonify(
            {
                "status": "ok",
                "place": "Litvínovice",
                "current": data.get("current", {}),
                "daily": data.get("daily", {}),
            }
        )
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.get("/api/hydro")
def hydro():
    """Live water levels for Vltava (Č. Budějovice) and Malše (Roudné)."""
    limits = _get_spa_limits()
    stations = []
    errors = []
    for st in HYDRO_STATIONS:
        try:
            series = _fetch_station(st["objID"])
            h = (series.get("H") or [{}])[-1]
            q = (series.get("Q") or [{}])
            q = q[-1] if q else {}
            th = (series.get("TH") or [{}])
            th = th[-1] if th else {}
            # tendency: compare last value with value ~1h ago (6 x 10min)
            h_list = series.get("H") or []
            tend = "stable"
            if len(h_list) >= 7:
                diff = (h_list[-1].get("value") or 0) - (h_list[-7].get("value") or 0)
                if diff >= 3:
                    tend = "rising"
                elif diff <= -3:
                    tend = "falling"
            lim = limits.get(st["dbc"], {})
            level = h.get("value")
            spa = 0
            try:
                if lim.get("spa3") and level is not None and level >= lim["spa3"]:
                    spa = 3
                elif lim.get("spa2") and level is not None and level >= lim["spa2"]:
                    spa = 2
                elif lim.get("spa1") and level is not None and level >= lim["spa1"]:
                    spa = 1
            except Exception:
                pass
            stations.append(
                {
                    "name": st["name"],
                    "river": st["river"],
                    "level_cm": level,
                    "flow_m3s": q.get("value"),
                    "temp_c": th.get("value"),
                    "time": h.get("dt"),
                    "tendency": tend,
                    "spa": spa,
                    "limits": lim,
                }
            )
        except Exception as e:
            errors.append(f"{st['name']}: {e}")
    status = "ok" if stations else "error"
    return jsonify(
        {
            "status": status,
            "stations": stations,
            "errors": errors,
            "source": "ČHMÚ open data (opendata.chmi.cz)",
            "detail_url": "https://hydro.chmi.cz/hpps/",
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
