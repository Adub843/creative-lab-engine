"""The weather, answered by code from a real forecast (2026-11-17).

A small model handed web snippets made up a forecast ("78 degrees, sunset 7:05 PM" in November), so weather
questions are answered here instead: Open-Meteo's free forecast, no key. Only the place name leaves the Blink
(the home city, Charleston, SC, unless the question names another place). Returns None when it cannot answer,
and the caller carries on as before.
"""
import datetime
import json
import re
import urllib.parse
import urllib.request

HOME = ("Charleston, South Carolina", 32.7766, -79.9309, "America/New_York")
ASK_RE = re.compile(r"\b(weather|forecast|temperature|how (?:hot|cold|warm)|(?:is it|will it|going to) (?:rain|snow|storm)\w*|"
                    r"do i need (?:an? )?(?:umbrella|jacket|coat))\b", re.I)
PLACE_RE = re.compile(r"\b(?:in|for|at|near|around)\s+([A-Z][A-Za-z.'-]+(?:[ ,]+[A-Z][A-Za-z.'-]+){0,3})")
NOT_PLACE = re.compile(r"^(?:the|my|our|this|that|a|an|today|tomorrow|tonight|morning|afternoon|evening|weekend|"
                       r"monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I)
HERE_RE = re.compile(r"\b(here|outside|near me|my area|at home|charleston)\b", re.I)
CODES = {0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "foggy", 51: "light drizzle",
         53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain",
         65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
         77: "snow", 80: "light showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "snow showers",
         95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail"}
STATES = {"AL": "Alabama", "AR": "Arkansas", "FL": "Florida", "GA": "Georgia", "NC": "North Carolina", "SC": "South Carolina",
          "TN": "Tennessee", "TX": "Texas", "VA": "Virginia", "NY": "New York", "CA": "California", "MS": "Mississippi",
          "LA": "Louisiana", "KY": "Kentucky", "OH": "Ohio", "MO": "Missouri"}


def fetch(url):
    """One GET that returns JSON. Replaced in tests."""
    req = urllib.request.Request(url, headers={"User-Agent": "home-assistant-weather"})
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.load(r)


def place_in(message):
    """The place the question names, or None for the home city."""
    m = PLACE_RE.search(message or "")
    if not m or NOT_PLACE.match(m.group(1)):
        return None
    return " ".join(m.group(1).replace(",", " ").split())


def locate(name):
    """(label, latitude, longitude, timezone) for a place name, or None."""
    words = name.split()
    state = None
    for n in (2, 1):                                   # "Jonesboro Arkansas", "Columbia South Carolina", "Memphis TN"
        tail = " ".join(words[-n:])
        full = STATES.get(tail.upper(), tail.title())
        if len(words) > n and full in STATES.values():
            state, words = full, words[:-n]
            break
    q = urllib.parse.urlencode({"name": " ".join(words), "count": 10, "language": "en", "format": "json"})
    rows = (fetch("https://geocoding-api.open-meteo.com/v1/search?" + q) or {}).get("results") or []
    if state:
        rows = [r for r in rows if r.get("admin1") == state] or rows
    if not rows:
        return None
    r = rows[0]
    label = ", ".join(x for x in (r.get("name"), r.get("admin1") if r.get("country_code") == "US" else r.get("country")) if x)
    return (label, r["latitude"], r["longitude"], r.get("timezone") or "auto")


def handle(message, today=None):
    """A spoken-style forecast, or None when this is not a weather question or the forecast could not be had."""
    m = message or ""
    if not ASK_RE.search(m) or len(m) > 300:
        return None
    try:
        name = place_in(m)
        spot = HOME if (not name or HERE_RE.fullmatch(name)) else locate(name)
        if not spot:
            return None
        label, lat, lon, tz = spot
        q = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "timezone": tz, "forecast_days": 3,
                                    "temperature_unit": "fahrenheit", "wind_speed_unit": "mph",
                                    "current": "temperature_2m,weather_code",
                                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
        data = fetch("https://api.open-meteo.com/v1/forecast?" + q)
        d = data["daily"]

        def day(i):
            return "%s, high %d, low %d, %d%% chance of rain" % (
                CODES.get(d["weather_code"][i], "mixed"), round(d["temperature_2m_max"][i]), round(d["temperature_2m_min"][i]),
                d["precipitation_probability_max"][i] or 0)
        if re.search(r"\btomorrow\b", m, re.I):
            return "Tomorrow in %s: %s." % (label, day(1))
        now = data.get("current") or {}
        first = "In %s it is %d degrees and %s right now. " % (label, round(now["temperature_2m"]), CODES.get(now.get("weather_code"), "mixed")) \
            if "temperature_2m" in now else ""
        return "%sToday: %s. Tomorrow: %s." % (first, day(0), day(1))
    except Exception:
        return None
