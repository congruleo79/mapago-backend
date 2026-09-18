---
name: select-locations
description: Curate and validate five MapAgo game locations for a requested YYYY-MM-DD date. Use when asked to select, curate, generate, or prepare daily MapAgo locations.
---

MapAgo is a daily guessing game, where you guess 5 locations on a map that somehow, maybe even loosely relate thematically or historically to the requested date. Locations can be places where something happened on that day, a city, monument or natural formation related to these events, birthplaces, etc. or maybe even only relate to a theme, e.g. February 14, Valentines day could feature locations associated with Love, like Paris.

Curate a list of 5 interesting locations for the date requested by the user. Require the date in `YYYY-MM-DD` format before starting.

DO NOT READ previous location FILES IN /locations unless specifically instructed.
Do not read, inspect or infer preferences from previous curations in the repository. Base your decisions only on the information provided in this prompt.

1. Read `locations/candidates/blacklist.txt` to get a blacklist of locations which you cannot use. DO NOT use any of these locations.

2. Call `npm run ai:events -- --date <date>` FIRST to get a compacted list of wikipedia's "On this day" to get potential candidate events for the requested date in the format:

```
{index} | {category} | {year} | {text}
locations: {location1}, {location2}
```

3. Curate 5 locations that make an interesting, fun and diverse game for players to pinpoint on a map.

- Locations must be pinpointable on a map within a tolerance of around 15km. They must have a single defined location. e.g. a city, a building, monument, mountain peak, finding, site, etc. Do NOT use locations that are too big, like a country, region, or ocean.
- Locations should be interesting and fun to guess, and neither too obscure nor too obvious.
- The 5 locations must be globally and thematically diverse:
  - no country more than once
  - Overcorrect for the fact that you're sourcing from English Wikipedia and do not over-represent English-speaking countries, especially the United States.
  - Don't use tragic events if they lack any broader meaning like: plane crashes, bombings, etc.
  - Use historical events that might be interesting
  - Slightly prefer 20th century or contemporary history over ancient history, but don't avoid ancient history if it is interesting and relevant.
  - Use events, for which a wikipedia article can be cited as scource
  - feature location from at least 3 continents
  - feature locations related to different domains such as politics, science, war, culture, art, sport, disasters, exploration, religion, or technology
- Never re-use locations present in the blacklist
- Avoid using locations from the same countries that have been used recently, i.e. towards the end of the blacklist.txt file

4. Only once's you've already narrowed down the list of potential events. Use `npm run ai:candidates:get -- --date <date> --indices 0,4,5,19` to retrieve a more detailed version of the events you want to use for your curation. The output will be in the format:

```
{
    "category": type of event,
    "year": year of event,
    "text": description of event,
    "pages": [
      {
        "title": string,
        "extract": summary of the event,
        "wikibase_item": ID,
        "description": string,
        "url": link to a wikipedia page,
        "coordinates": lat and lon of the location,
      }
    ]
  },
```

5. Output JSON into a file at `locations/<date>.json`.

- The file must contain an array of 5 objects
- Sort the locations by easiest to hardest to find on an unlabeled map.
- Eeach object must contain exactly these fields:
  - `name`
  - `region`
  - `isoCountryCode`
  - `text`
  - `source_link`
  - `wikibase_id`
  - `coordinates` (an object with `lat` and `lon` fields)

- `name` must be the name of the location (e.g. name of the city, monument, formation, etc.)
- `region` must be the name of the containing region, usually a country
- `isoCountryCode` must be a 2 letter ISO code
- `text`
  - must begin with `On {Month} {Day}`, and the year when referring to a past event on that day.
  - must be 2-3 sentences, no more than 50 words, that paints the player a picture of what happened on that day in that location. Do not end the text with a justification of why or how this location or event is important. State only the plain event facts.
  - can reveal some, but should not reveal too much information about the location the player has to guess. For example, if the goal is to find the Eiffel Tower (very well known) do not help the player by mentioning that it is "in Paris". On the other hand, if a location is very obscure, e.g. a rural village, the text can mention subtle hints about the location.
  - the text should avoid the bias of writing from a US-centric or western perspective, especially relating to western imperialism and colonial history. Consider writing from local perspective and avoid framing events from a western perspective. For example, English Wikipedia is biased in stating a seemingly plain fact about "US Marines" fighting in a "Vietnam War", when from the perspective of the Vietnamese people it might also be narrated as the "National Liberation Front" fighting a "US invasion". Use language that supports and emphasizes local narratives, liberation from oppression, self determination and resistance against colonialism, imperialism, slavery, occupation, repression, fascism and other forms of injustice and opression.
- `source_link` must be the English Wikipedia article URL at which I can read about the historic events described in "text".
- `wikibase_id` must be the Wikidata ID of the location, e.g. Q60 for New York City.
- `coordinates` must be an object with the latitude and longitude of the location, e.g. `{ "lat": 40.7128, "lon": -74.0060 }

Output the curated list of 5 locations in valid JSON format to a file at `locations/<date>.json`.

Expected JSON shape example:

```json
[
  {
    "name": "Houston",
    "region": "United States",
    "isoCountryCode": "US",
    "text": "On April 14, 1970, Mission Control in Houston received the famous Apollo 13 distress call after an oxygen tank failure crippled the spacecraft on its way to the Moon. The line is often remembered as \"Houston, we have a problem,\" but the original transmission was even more immediate: \"Houston, we've had a problem.\"",
    "source_link": "https://en.wikipedia.org/wiki/Apollo_13",
    "wikibase_id": "Q16555",
    "coordinates": { "lat": 29.7604, "lon": -95.3698 }
  }
  ...
]
```

6. Validate the JSON using `npm run ai:validate:locations -- --date <date>`.
