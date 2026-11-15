// ECO DRIFT - main script
// Team Zelo Radiation
//
// This file has 3 parts:
//   part 1 - getting the data and doing the maths (the "backend")
//   part 2 - map outlines (just long lists of numbers)
//   part 3 - everything you see: intro, globe, tabs, cards


// ---------------- PART 1: DATA AND MATHS ----------------

// where we get the data from
let powerYears = "https://power.larc.nasa.gov/api/temporal/monthly/point";      // NASA POWER, one value per month
let power      = "https://power.larc.nasa.gov/api/temporal/climatology/point";  // NASA POWER, long-term averages
let noaaCdo    = "https://www.ncei.noaa.gov/access/services/data/v1";           // NOAA weather stations
let modis      = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset";            // MODIS plant greenness (NDVI)
let modisDates = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/dates";             // days that have a MODIS picture
let erddap     = "https://coastwatch.pfeg.noaa.gov/erddap/griddap";             // NOAA sea data
let gibs       = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=16,34,33,56&WIDTH=600&HEIGHT=464&FORMAT=image/png";   // NASA map pictures of Saudi Arabia

// NOAA uses different names, and only has these 3
let noaaCodes = {
    T2M: "TAVG",          // air temperature
    PRECTOTCORR: "PRCP",  // rain
    WS2M: "AWND"          // wind
};

let charts = {};      // all the charts, by canvas id
let choice = {};      // what the user picked (source, variable, months, years)
let labels = [];      // years along the bottom of the trend chart
let busy = false;     // stops two tests running at the same time

// City B uses the same city list as City A, starting on Abha
document.getElementById("cityB").innerHTML = document.getElementById("cityA").innerHTML;
document.getElementById("cityB").value = "18.22,42.51,SAM00041112";


// --- small helpers ---

function get(id) {                       // value of a box
    return document.getElementById(id).value;
}

function show(id, text) {                // put text on the page
    document.getElementById(id).innerHTML = text;
}

function picked(id) {                    // the chosen <option> in a list
    let box = document.getElementById(id);
    return box.options[box.selectedIndex];
}

function signed(number) {                // 0.5 -> "+0.500"
    if (number > 0) { return "+" + number.toFixed(3); }
    return number.toFixed(3);
}

function chance(p) {                     // 0.0312 -> "3.12%"
    if (p < 0.0001) { return "less than 0.01%"; }
    return (p * 100).toFixed(2) + "%";
}

function draw(id, type, data, options) { // draw a chart (remove the old one first)
    if (charts[id]) { charts[id].destroy(); }
    charts[id] = new Chart(document.getElementById(id), { type: type, data: data, options: options });
}

// read the 4 boxes in "The case"
function readChoices() {
    let variable = get("variable").split(",");   // e.g. "T2M,°C"
    let period = get("period").split(",");       // e.g. "1984,2025"
    choice = {
        source: get("source"),
        code: variable[0],
        unit: variable[1],
        what: picked("variable").text,
        months: get("months").split(","),
        season: picked("months").text,
        firstYear: Number(period[0]),
        lastYear: Number(period[1])
    };
}


// --- turning raw data into one number per year ---
// both functions return: years, values, and chartValues (null = gap in the chart)

// NASA gives monthly values named like "198407" (July 1984)
function makeSeries(numbers) {
    let years = [];
    let values = [];
    let chartValues = [];
    labels = [];

    // winter = December of the year before + Jan + Feb
    let winter = choice.months.join(",") == "12,1,2";

    for (let year = choice.firstYear; year <= choice.lastYear; year++) {
        let total = 0;
        let count = 0;

        for (let m = 0; m < choice.months.length; m++) {
            let month = Number(choice.months[m]);
            let dataYear = year;
            if (winter && month == 12) { dataYear = year - 1; }
            if (month < 10) { month = "0" + month; }
            let value = numbers[`${dataYear}${month}`];

            if (value != undefined && value != -999) {   // -999 means no data
                total = total + value;
                count = count + 1;
            }
        }

        labels.push(year);
        if (count == choice.months.length) {             // only keep full years
            years.push(year);
            values.push(total / count);
            chartValues.push(total / count);
        } else {
            chartValues.push(null);
        }
    }
    return { years: years, values: values, chartValues: chartValues };
}

// NOAA gives one row per year, like { DATE: "1990", TAVG: "25.3" }
function makeNoaaSeries(rows, cdoCode) {
    if (!Array.isArray(rows)) { rows = []; }             // NOAA sent an error instead of data

    let byYear = {};
    for (let i = 0; i < rows.length; i++) {
        let yr = parseInt(rows[i].DATE);
        if (rows[i][cdoCode] != undefined) {
            let val = parseFloat(rows[i][cdoCode]);
            if (cdoCode == "PRCP") { val = val / 365.25; }   // NOAA rain is per year, NASA's is per day
            byYear[yr] = val;
        }
    }

    let years = [];
    let values = [];
    let chartValues = [];
    labels = [];

    for (let year = choice.firstYear; year <= choice.lastYear; year++) {
        labels.push(year);
        if (byYear[year] != undefined && !isNaN(byYear[year])) {
            years.push(year);
            values.push(byYear[year]);
            chartValues.push(byYear[year]);
        } else {
            chartValues.push(null);
        }
    }
    return { years: years, values: values, chartValues: chartValues };
}


// --- the maths ---

// best-fit line (least squares). slope = change per year
function bestLine(years, values) {
    let n = years.length;
    let sumYears = 0;
    let sumValues = 0;

    for (let i = 0; i < n; i++) {
        sumYears = sumYears + years[i];
        sumValues = sumValues + values[i];
    }
    let meanYear = sumYears / n;
    let meanValue = sumValues / n;

    let top = 0;
    let bottom = 0;
    for (let i = 0; i < n; i++) {
        top = top + (years[i] - meanYear) * (values[i] - meanValue);
        bottom = bottom + (years[i] - meanYear) * (years[i] - meanYear);
    }
    let slope = top / bottom;
    let start = meanValue - slope * meanYear;   // only used to draw the line

    return { slope: slope, start: start };
}

// area under the bell curve from 0 to z, using 1000 thin rectangles
function bellArea(z) {
    let width = z / 1000;
    let area = 0;
    for (let i = 0; i < 1000; i++) {
        let x = (i + 0.5) * width;
        let height = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
        area = area + height * width;
    }
    return area;
}

// Mann-Kendall test: is the trend real or just noise?
// S = pairs that went up - pairs that went down
// p = chance of getting this from random noise
function mannKendall(values) {
    let n = values.length;
    let S = 0;
    let ties = 0;

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {        // compare with every later year
            if (values[j] > values[i]) { S = S + 1; }
            if (values[j] < values[i]) { S = S - 1; }
        }

        let same = 0;                            // years with exactly the same value
        for (let j = 0; j < n; j++) {
            if (values[j] == values[i]) { same = same + 1; }
        }
        ties = ties + (same - 1) * (2 * same + 5);
    }

    let variance = (n * (n - 1) * (2 * n + 5) - ties) / 18;

    let Z = 0;
    if (S > 0) { Z = (S - 1) / Math.sqrt(variance); }
    if (S < 0) { Z = (S + 1) / Math.sqrt(variance); }

    let p = 1 - 2 * bellArea(Math.abs(Z));
    return { S: S, Z: Z, p: p };
}


// --- test one city ---
// option.value looks like "24.71,46.68,SA000040438" (lat, lon, NOAA station)
async function investigate(option) {
    let place = option.value.split(",");
    let lat = place[0];
    let lon = place[1];
    let stationId = place[2];

    let series;
    let usedNoaa = false;
    let usedSource = "POWER";
    let cdoCode = noaaCodes[choice.code];   // undefined if NOAA doesn't measure it

    // try NOAA first if the user picked it
    if (choice.source == "NOAA" && cdoCode) {
        try {
            let noaaUrl = `${noaaCdo}?dataset=global-summary-of-the-year&stations=${stationId}&dataTypes=${cdoCode}&startDate=${choice.firstYear}-01-01&endDate=${choice.lastYear}-12-31&units=metric&format=json`;
            let noaaResponse = await fetch(noaaUrl);
            let noaaData = await noaaResponse.json();
            series = makeNoaaSeries(noaaData, cdoCode);
        } catch (error) {
            series = undefined;              // NOAA didn't work, we'll use NASA
        }
        if (series && series.years.length >= 10) {
            usedNoaa = true;
            usedSource = `NOAA CDO (${stationId})`;
        }
    }

    // otherwise use NASA
    if (!usedNoaa) {
        let startYear = choice.firstYear;
        if (choice.months.join(",") == "12,1,2") { startYear = startYear - 1; }   // winter needs last December

        let nasaUrl = `${powerYears}?parameters=${choice.code}&community=AG&latitude=${lat}&longitude=${lon}&start=${startYear}&end=${choice.lastYear}&format=JSON`;
        let nasaResponse = await fetch(nasaUrl);
        let nasaData = await nasaResponse.json();

        if (!nasaData.properties) { throw "The data server did not send data for this choice."; }
        series = makeSeries(nasaData.properties.parameter[choice.code]);

        if (choice.source == "NOAA" && cdoCode) {
            usedSource = "POWER (fallback: NOAA station had under 10 years)";
        } else if (choice.source == "NOAA") {
            usedSource = "POWER (NOAA stations do not measure this)";
        }
    }

    if (series.years.length < 10) { throw "Not enough years of data (the test needs 10)."; }

    let line = bestLine(series.years, series.values);
    let test = mannKendall(series.values);

    let direction = "FLAT";
    if (test.S > 0) { direction = "RISING"; }
    if (test.S < 0) { direction = "FALLING"; }

    let season = choice.season;
    if (usedNoaa) { season = "Whole year (NOAA has yearly values only)"; }

    return {
        city: option.text,
        source: usedSource,
        season: season,
        lat: Number(lat),
        lon: Number(lon),
        firstYear: series.years[0],
        lastYear: series.years[series.years.length - 1],
        count: series.years.length,
        chartValues: series.chartValues,
        slope: line.slope,
        start: line.start,
        S: test.S,
        Z: test.Z,
        p: test.p,
        direction: direction,
        real: test.p < 0.05              // real = less than 5% chance of noise
    };
}

// the text on a result card
function report(r) {
    let what = `no clear trend (leaning ${r.direction}, but not proven)`;
    let verdict = "NO - this could just be random noise";
    if (r.real) {
        what = `${choice.what} is ${r.direction}`;
        verdict = "YES - this is a real trend";
    }
    return `<b>${r.city}</b> [${r.source}] - ${choice.what}, ${r.season}, ${r.firstYear} to ${r.lastYear} (${r.count} years)<br>` +
           `WHAT: ${what}<br>` +
           `HOW MUCH: ${signed(r.slope * 10)} ${choice.unit} every 10 years (${signed(r.slope * (r.lastYear - r.firstYear))} ${choice.unit} in total)<br>` +
           `SIGNIFICANT? ${verdict}<br>` +
           `Mann-Kendall: S = ${r.S}, Z = ${r.Z.toFixed(2)}, chance of random noise = ${chance(r.p)} (must be under 5%)`;
}

// one sentence comparing the two cities
function compare(a, b) {
    if (a.real && b.real && a.direction != b.direction) {
        return `These two cities are going opposite ways: ${a.city} is ${a.direction} and ${b.city} is ${b.direction}. ` +
               `The same cause can do this in different places (see Causes &amp; solutions).`;
    }
    if (a.real && b.real) {
        let faster = a;
        if (Math.abs(b.slope) > Math.abs(a.slope)) { faster = b; }
        return `Both cities are ${a.direction}. ${faster.city} is changing faster (${signed(faster.slope * 10)} ${choice.unit} every 10 years).`;
    }
    if (a.real) { return `Only ${a.city} has a real trend. ${b.city} does not.`; }
    if (b.real) { return `Only ${b.city} has a real trend. ${a.city} does not.`; }
    return "Neither city has a real trend for this choice.";
}

// adds 2 lines for a city to the chart: the data and the dashed trend line
function addLines(lines, r, color) {
    let trend = [];
    for (let i = 0; i < labels.length; i++) {
        trend.push(r.start + r.slope * labels[i]);
    }
    lines.push({ label: r.city, data: r.chartValues, borderColor: color });
    lines.push({ label: r.city + " trend", data: trend, borderColor: color, borderDash: [6, 6], pointRadius: 0 });
}


// --- "Detect Trend" button ---
async function detect() {
    if (busy) { return; }
    busy = true;
    readChoices();

    show("resultA", "");
    show("resultB", "");
    show("where", "Asking POWER / NOAA...");

    try {
        let a = await investigate(picked("cityA"));
        show("resultA", report(a));

        let b = await investigate(picked("cityB"));
        show("resultB", report(b));
        show("where", "<b>WHERE:</b> " + compare(a, b));

        let lines = [];
        addLines(lines, a, "red");       // part 3 swaps these for our own colours
        addLines(lines, b, "blue");
        draw("trendChart", "line", { labels: labels, datasets: lines });
    } catch (error) {
        show("where", "Problem: " + error);
    }
    busy = false;
}


// --- "Scan All Cities" button ---
async function scanAll() {
    if (busy) { return; }
    busy = true;
    readChoices();

    let rising = [];
    let falling = [];
    let noTrend = [];
    let failed = 0;
    let cities = document.getElementById("cityA").options;

    show("table", "<tr><th>City</th><th>Source</th><th>Direction</th><th>Change every 10 years</th><th>Chance of noise</th><th>Real trend?</th></tr>");

    try {
        for (let i = 0; i < cities.length; i++) {
            show("scan", `Scanning ${cities[i].text} (${i + 1} of ${cities.length})...`);

            let r;
            try {
                r = await investigate(cities[i]);
            } catch (error) {                    // skip a city with no data, keep going
                failed = failed + 1;
                document.getElementById("table").innerHTML +=
                    `<tr><td>${cities[i].text}</td><td colspan="5">No data: ${error}</td></tr>`;
                continue;
            }

            let dot = { x: r.lon, y: r.lat };    // position on the map chart
            let answer = r.real ? "YES" : "No";

            if (r.real && r.S > 0) { rising.push(dot); }
            else if (r.real) { falling.push(dot); }
            else { noTrend.push(dot); }

            document.getElementById("table").innerHTML +=
                `<tr><td>${r.city}</td><td>${r.source}</td><td>${r.direction}</td><td>${signed(r.slope * 10)} ${choice.unit}</td><td>${chance(r.p)}</td><td>${answer}</td></tr>`;
        }

        let summary = `${choice.what}, ${choice.season}: ${rising.length} cities rising, ${falling.length} falling, ${noTrend.length} with no real trend.`;
        if (failed > 0) { summary = summary + ` ${failed} could not be tested.`; }
        show("scan", summary);

        draw("mapChart", "scatter", {
            datasets: [
                { label: "Real rising trend", data: rising, backgroundColor: "red", pointRadius: 8 },
                { label: "Real falling trend", data: falling, backgroundColor: "blue", pointRadius: 8 },
                { label: "No real trend", data: noTrend, backgroundColor: "gray", pointRadius: 8 }
            ]
        }, {
            scales: {
                x: { title: { display: true, text: "Longitude (west to east)" } },
                y: { title: { display: true, text: "Latitude (south to north)" } }
            }
        });
    } catch (error) {
        show("scan", "Scan stopped: " + error);
    }
    busy = false;
}


// --- "Get Data" button (From space tab) ---

// the sea server sends its answer back as a script that calls our function (JSONP)
function loadScript(link, id) {
    let script = document.createElement("script");
    script.src = link;
    script.onload = () => script.remove();      // tidy up after
    script.onerror = () => { show(id, "Could not load this data."); script.remove(); };
    document.body.appendChild(script);
}

function showSea(data) {
    show("sst", "Sea temperature: " + data.table.rows[0][3] + " °C");
}

function showWater(data) {
    let value = data.table.rows[0][3];
    if (value == null) { show("chl", "Water quality: no data here right now (clouds)"); }
    else { show("chl", "Water quality: " + value + " mg/m3"); }
}

async function getData() {
    if (get("date") == "" || get("start") == "" || get("end") == "") {
        show("temp", "Please pick all three dates first.");
        return;
    }

    let city = get("cityA").split(",");          // uses City A
    let lat = city[0];
    let lon = city[1];
    let stationId = city[2];

    let sea = get("sea").split(",");
    let spot = `%5B(last)%5D%5B(${sea[0]})%5D%5B(${sea[1]})%5D`;   // [(last)][(lat)][(lon)]

    show("temp", "Temperature: loading...");
    show("rain", "Rain: loading...");
    show("cdo", "NOAA CDO Station: loading...");
    show("ndvi", "Plants: loading...");
    show("sst", "Sea temperature: loading...");
    show("chl", "Water quality: loading...");

    // these load on their own, so start them first
    loadScript(`${erddap}/jplMURSST41.json?analysed_sst${spot}&.jsonp=showSea`, "sst");
    loadScript(`${erddap}/erdMH1chla8day_R202SQ.json?chlor_a${spot}&.jsonp=showWater`, "chl");
    document.getElementById("plantmap").src = `${gibs}&LAYERS=MODIS_Terra_L3_NDVI_16Day&TIME=${get("end")}`;   // 16-day layer goes back to 2000
    document.getElementById("air").src = `${gibs}&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor,MODIS_Terra_Aerosol&TIME=${get("date")}`;

    // NASA long-term averages
    try {
        let url = `${power}?parameters=T2M,PRECTOTCORR&community=AG&latitude=${lat}&longitude=${lon}&format=JSON`;
        let response = await fetch(url);
        let data = await response.json();
        show("temp", "Temperature: " + data.properties.parameter.T2M.ANN + " °C");
        show("rain", "Rain: " + data.properties.parameter.PRECTOTCORR.ANN + " mm per day");
    } catch (error) {
        show("temp", "Temperature problem: " + error);
        show("rain", "Rain problem: " + error);
    }

    // newest NOAA station year
    try {
        let cdoUrl = `${noaaCdo}?dataset=global-summary-of-the-year&stations=${stationId}&dataTypes=TAVG,PRCP,AWND&startDate=2020-01-01&endDate=2025-12-31&units=metric&format=json`;
        let cdoResponse = await fetch(cdoUrl);
        let cdoData = await cdoResponse.json();

        if (cdoData.length > 0) {
            let latest = cdoData[cdoData.length - 1];
            let yr = parseInt(latest.DATE);
            show("cdo", `NOAA CDO (${stationId}, ${yr}): Air Temp = ${latest.TAVG || "-"} °C, Rain = ${latest.PRCP || "-"} mm/yr, Wind = ${latest.AWND || "-"} m/s`);
        } else {
            show("cdo", `NOAA CDO (${stationId}): No recent station rows found.`);
        }
    } catch (error) {
        show("cdo", "NOAA CDO problem: " + error);
    }

    // MODIS plant greenness (NDVI)
    // The server only accepts days that have a picture (one every 16 days)
    // and max 10 pictures per request. So we get the list of picture days first,
    // keep the ones in our date range, then ask 10 at a time.
    try {
        let start = get("start");
        let end = get("end");
        if (start > end) { let keep = start; start = end; end = keep; }   // dates typed backwards

        let listResponse = await fetch(`${modisDates}?latitude=${lat}&longitude=${lon}`, { headers: { Accept: "application/json" } });
        if (!listResponse.ok) { throw "the MODIS server answered with error " + listResponse.status; }
        let list = (await listResponse.json()).dates;

        let wanted = [];
        for (let i = 0; i < list.length; i++) {
            if (list[i].calendar_date >= start && list[i].calendar_date <= end) {
                wanted.push(list[i].modis_date);
            }
        }
        if (wanted.length == 0) { throw "no satellite pictures between these dates. Pick dates at least 16 days apart."; }
        let firstWanted = 0;
        if (wanted.length > 100) { firstWanted = wanted.length - 100; }   // newest 100 max (about 4 years)

        let dates = [];
        let values = [];
        for (let first = firstWanted; first < wanted.length; first = first + 10) {
            let last = Math.min(first + 9, wanted.length - 1);
            show("ndvi", `Plants: loading pictures ${first - firstWanted + 1} to ${last - firstWanted + 1} of ${wanted.length - firstWanted}...`);

            let modisUrl = `${modis}?latitude=${lat}&longitude=${lon}&band=250m_16_days_NDVI&startDate=${wanted[first]}&endDate=${wanted[last]}&kmAboveBelow=0&kmLeftRight=0`;
            let modisResponse = await fetch(modisUrl, { headers: { Accept: "application/json" } });
            if (!modisResponse.ok) { throw "the MODIS server answered with error " + modisResponse.status; }
            let modisData = await modisResponse.json();

            for (let i = 0; i < modisData.subset.length; i++) {
                let raw = modisData.subset[i].data[0];
                if (raw > -3000) {                   // -3000 = cloud, no picture
                    dates.push(modisData.subset[i].calendar_date);
                    values.push(raw / 10000);        // stored as NDVI x 10000
                }
            }
        }
        if (values.length == 0) { throw "every picture in this range was hidden by cloud."; }

        let sum = 0;
        let lowest = values[0];
        let highest = values[0];
        for (let i = 0; i < values.length; i++) {
            sum = sum + values[i];
            if (values[i] < lowest) { lowest = values[i]; }
            if (values[i] > highest) { highest = values[i]; }
        }
        show("ndvi", `Plants (NDVI): ${values.length} pictures, ${dates[0]} to ${dates[dates.length - 1]}. ` +
                     `Average ${(sum / values.length).toFixed(3)}, lowest ${lowest.toFixed(3)}, highest ${highest.toFixed(3)}.`);
        draw("chart", "line", { labels: dates, datasets: [{ label: "NDVI", data: values, borderColor: "green" }] });
    } catch (error) {
        show("ndvi", "Plants problem: " + error);
    }
}


// --- "Is my area getting hotter?" tab ---
// Gets the yearly air temperature (1984-2025) for any place from NASA POWER,
// then runs the same Mann-Kendall test as the rest of the site.

function useMyLocation() {
    if (!navigator.geolocation) {
        show("myAnswer", "Your browser can't share your location. Type it in and press Check.");
        return;
    }
    show("myAnswer", "Finding your location...");
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            document.getElementById("myLat").value = pos.coords.latitude.toFixed(2);
            document.getElementById("myLon").value = pos.coords.longitude.toFixed(2);
            checkMyArea();
        },
        function () {
            show("myAnswer", "We couldn't get your location (maybe it was blocked). Type it in and press Check.");
        }
    );
}

async function checkMyArea() {
    let lat = Number(get("myLat"));
    let lon = Number(get("myLon"));
    if (get("myLat") == "" || get("myLon") == "" || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        show("myAnswer", "Please type a latitude (-90 to 90) and a longitude (-180 to 180).");
        return;
    }
    show("myAnswer", "Asking POWER for 42 years of temperatures...");

    try {
        let url = `${powerYears}?parameters=T2M&community=AG&latitude=${lat}&longitude=${lon}&start=1984&end=2025&format=JSON`;
        let response = await fetch(url);
        let data = await response.json();
        if (!data.properties) { throw "The data server did not send data for this place."; }
        let monthly = data.properties.parameter.T2M;

        // average the 12 months of each year
        let years = [];
        let temps = [];
        for (let year = 1984; year <= 2025; year++) {
            let total = 0;
            let count = 0;
            for (let m = 1; m <= 12; m++) {
                let month = m;
                if (m < 10) { month = "0" + m; }
                let value = monthly[`${year}${month}`];
                if (value != undefined && value != -999) {
                    total = total + value;
                    count = count + 1;
                }
            }
            if (count == 12) {
                years.push(year);
                temps.push(total / 12);
            }
        }
        if (years.length < 10) { throw "not enough years of data here."; }

        let line = bestLine(years, temps);
        let test = mannKendall(temps);
        let first = years[0];
        let last = years[years.length - 1];

        let answer = "<b>Not clearly.</b> The temperature goes up and down, but it could just be random.";
        if (test.p < 0.05 && test.S > 0) { answer = "<b>Yes, your area is getting hotter.</b>"; }
        if (test.p < 0.05 && test.S < 0) { answer = "<b>No, it's actually getting cooler.</b>"; }

        show("myAnswer", `${answer}<br>` +
            `Change: ${signed(line.slope * 10)} °C every 10 years (${signed(line.slope * (last - first))} °C from ${first} to ${last}).<br>` +
            `Chance this is just noise: ${chance(test.p)} (it counts as real if it's under 5%).`);

        let trend = [];
        for (let i = 0; i < years.length; i++) {
            trend.push(line.start + line.slope * years[i]);
        }
        draw("myChart", "line", {
            labels: years,
            datasets: [
                { label: "Yearly average temperature", data: temps },
                { label: "Trend", data: trend, borderDash: [6, 6], pointRadius: 0 }
            ]
        });
    } catch (error) {
        show("myAnswer", "Problem: " + error);
    }
}


// ---------------- PART 2: MAP OUTLINES ----------------
// LAND = coastlines, saved as small steps to keep it short (only used if the
// NASA Earth picture doesn't load). OUTLINE = the Saudi border as [lon, lat] points.
const LAND = "-298,-400,-3,-5,-28,2,20,1,6,4,5,-2;-796,-397,-10,-1,-13,5,13,1,10,-5;-226,-390,6,-2,3,-8,-35,-5,-19,2,16,5,12,8,17,0;-495,-360,11,0,3,-3,-16,1,-15,3,17,-1;-342,-355,-2,-6,-11,-2,-20,3,0,2,5,2,10,0,1,8,8,4,9,-11;-900,-424,5,3,23,-2,22,4,60,-8,47,-1,27,3,2,2,-54,5,4,8,-20,4,31,-1,21,5,-16,5,-29,2,-13,5,-2,6,35,-3,26,5,0,5,6,1,3,-2,46,6,77,0,29,3,9,-5,58,-3,2,3,-12,3,-5,8,36,-5,32,1,4,4,20,-4,19,-2,6,3,20,-4,36,5,9,5,-7,11,5,6,-1,6,3,3,21,11,26,7,3,-2,-2,-1,-22,-5,-3,-3,2,-4,-8,-2,-9,-7,12,-6,7,-8,5,-14,-18,-8,-31,-7,-33,-1,18,-6,-22,-2,0,-4,7,-3,85,-13,7,-4,42,7,35,-1,10,3,61,5,-5,6,-30,-1,-1,5,35,9,44,5,21,6,2,1,-5,2,1,2,20,5,10,6,14,-2,3,3,12,-2,19,1,2,-2,40,9,9,-1,6,-4,13,4,9,-2,20,3,17,-4,22,1,25,4,9,5,24,-6,80,20,9,-1,12,-6,13,-4,13,3,24,-3,4,-6,-9,-6,6,-1,-5,-6,9,-2,6,1,14,11,19,2,8,5,18,6,20,0,6,5,8,-5,31,-1,20,1,15,8,17,-7,37,6,10,-4,21,-3,17,4,28,-2,30,3,1,4,12,-8,40,0,6,-4,11,-3,19,-2,8,1,37,-10,29,-1,19,-4,-10,-10,-16,-4,-12,-9,-1,-4,7,-6,11,-3,-26,-2,-10,-9,48,-14,44,-3,-1791,-2;-339,-269,14,-4,-3,-3,-7,2,-6,-4,-20,6,-12,8,17,-6,9,7,4,0,4,-6;-293,-255,4,-3,-1,-2,-13,-1,-3,2,13,4;727,-204,14,0,1,-6,-2,-6,-2,1,-4,-3,-4,0,-6,12,0,2,3,0;865,-205,6,-2,-7,-10,1,-2,-8,-2,-4,-9,-11,-3,-9,2,2,5,18,11,7,10,4,3,1,-3;873,-181,4,-5,0,3,7,-6,9,1,-3,-8,-4,0,-6,-10,-5,-1,-2,1,3,4,-2,2,-5,2,4,4,0,7,-10,14,9,-3,1,-5;836,-111,-9,3,-7,7,16,-10;-900,-83,1794,-2,-1,2,4,1,-1796,2,-1,-3;250,-68,2,-11,-4,0,1,-5,-14,-41,-8,-3,-7,3,-3,18,5,7,-2,13,2,6,10,2,7,6,7,13,4,-8;718,-69,2,-4,3,2,4,-4,5,-20,12,-7,4,-10,6,0,1,-5,11,-13,2,-11,-4,-17,-17,-31,-5,0,-10,-6,-8,3,1,3,-7,-5,-15,4,-5,9,-7,3,0,6,-7,-4,5,8,0,4,-9,-10,-4,2,-5,9,-14,6,-26,-4,-10,-4,-3,-4,-19,-1,-9,-5,-7,0,-8,4,4,10,-6,18,-6,12,2,-2,-2,5,4,-3,-4,9,4,13,0,-4,13,9,20,6,11,16,2,-4,2,1,-1,2,1,2,2,-1,7,11,7,2,7,-5,6,-1,-1,3,6,9,10,2,-4,5,3,0,14,-5,6,2,3,-3,-5,-5,-3,-8,24,-14,3,2,5,12,2,20,2,2,1,-3,4,-13;622,-51,-5,0,3,5,10,4,7,0,-15,-9;543,-34,10,0,1,2,25,-10,-6,-2,-20,3,-26,7,3,5,13,-5;760,-27,-11,-5,-7,3,7,1,1,3,4,-2,4,3,0,3,3,0,-1,-6;766,-22,-2,-2,-2,5,-9,5,2,2,11,-10;671,-6,1,-8,5,-3,4,5,11,3,31,-10,7,-8,8,-3,1,-3,-4,-1,1,-3,8,-9,10,-5,-4,-2,-10,2,-10,11,-6,2,-8,-3,1,-4,-4,-2,-17,7,-8,-2,5,5,-3,10,-22,9,-3,-3,-5,7,8,3,-7,0,-8,6,9,3,9,-4;626,7,-8,-6,-17,0,-1,-4,5,-4,12,4,-9,-7,8,-17,-5,1,3,4,-7,-1,-2,10,-3,-2,0,-13,-5,1,0,10,-3,3,6,17,4,4,11,-3,11,3;643,6,0,-5,-2,1,-1,-3,2,-3,-4,3,0,10,2,2,3,-5;529,-29,-5,0,-11,8,-20,30,-16,16,-1,2,11,-1,16,-16,5,0,11,-9,-2,-5,14,-11,-2,-14;589,9,6,-4,-6,-1,-1,-8,-5,-3,-2,-13,-1,2,-6,-3,-8,5,-6,-1,-1,2,-8,0,-6,17,3,8,4,-2,4,1,1,4,8,3,19,19,12,-8,-9,-11,2,-7;632,42,1,-6,-2,-5,-2,5,-2,-2,0,-6,-6,3,0,6,-3,2,-4,-2,-4,-3,2,6,15,5,0,4,4,-3,1,-4;406,31,-4,-1,-3,4,2,15,3,-3,5,-8,-3,-7;620,51,-5,-6,-3,4,2,2,1,3,2,1,0,-4,3,5,0,-5;593,47,-7,-5,9,10,3,5,0,-4,-5,-6;628,61,1,-6,-4,2,1,-5,-2,-1,-2,3,0,3,2,2,-3,4,7,-2;607,93,4,-1,2,-7,-5,-5,1,-8,11,-3,0,-6,-4,2,-1,3,-2,-2,-3,3,-7,0,2,4,-5,2,-1,7,2,-2,3,13,3,0;-363,99,13,-1,8,-5,-1,-2,-12,0,-2,-3,-5,3,-10,1,10,1,-5,5,4,1;552,93,-5,-2,-4,2,0,4,8,4,4,-3,-3,-5;-398,114,27,-13,-18,-2,4,3,-11,6,-13,3,-2,1,2,1,-16,-4,14,7,13,-2;606,114,-2,-4,-3,4,2,9,4,3,3,-1,-4,-11;673,171,-2,-5,-2,2,-4,-4,-3,1,3,5,8,1;78,191,-2,-8,-7,3,-7,2,1,3,15,0;46,206,3,-3,-1,-7,-6,0,-1,9,5,1;705,186,-4,-10,-15,-3,-7,-6,-3,2,-1,4,-20,-4,5,-3,-7,-11,-2,2,1,5,-5,4,16,11,15,1,6,9,3,-3,10,7,5,15,5,1,3,-7,-5,-14;720,221,7,1,1,-6,-8,-1,-4,-5,-8,3,-3,-5,-5,0,-1,5,3,4,5,0,3,11,10,-7;-618,243,-10,1,-12,6,-2,4,13,-3,11,-8;-281,253,-3,-4,3,2,4,-1,-2,-2,12,-2,-2,-3,4,0,2,-5,-2,-5,-6,1,0,5,-6,-5,-3,1,4,2,-5,1,-15,0,2,3,-2,2,9,11,8,4,2,0,-4,-5;-664,270,5,1,-1,-6,4,-4,-5,2,-5,6,2,1;718,254,5,-9,-7,2,-3,-8,5,-5,0,-3,-4,3,-4,-4,1,18,-3,12,0,7,5,2,-2,2,2,1,5,-18;-34,261,-16,-2,4,5,-2,5,10,7,10,-3,-6,-12;-15,293,-5,-5,10,0,-6,-8,6,0,12,-15,6,-1,-3,-5,2,-3,-4,-2,-32,-3,12,6,-9,3,5,2,-3,2,1,3,8,0,0,3,-9,4,-1,5,-3,-2,-3,7,6,9,10,0;-426,328,25,-9,-12,-1,-3,3,-12,-6,-1,3,-7,0,4,2,3,9,3,-1;-73,332,-1,-3,6,-3,-25,-9,-21,3,5,2,-11,2,9,1,-11,3,4,3,7,1,8,-3,8,2,22,1;-900,345,25,-9,0,-3,3,-1,-1,3,14,0,10,-5,-14,-3,-2,-6,-16,6,-11,0,-1,4,-6,-2,2,-2,-3,-2,1800,0,-13,-2,10,-8,-1,-3,-9,1,-19,-5,-16,-9,-7,4,-14,-4,-2,2,-11,-2,-8,-8,6,-3,-1,-7,-4,0,-2,-5,2,-2,-9,-2,-2,-6,-7,-1,-2,-5,-7,-5,-7,22,3,7,4,5,8,1,26,16,4,7,-6,-1,-3,-4,-12,-5,-4,6,-13,-2,-13,-8,4,-3,-19,-2,1,4,-8,0,-6,-2,-32,-1,-35,-21,8,-1,7,-4,9,2,7,-6,0,-4,-4,-5,-3,-14,-9,-10,-17,-15,-6,-3,-7,2,-11,-6,-1,-6,-11,-5,-1,-3,10,-12,-2,-9,-13,-3,-1,12,3,0,-3,5,-7,2,3,7,-6,2,-16,-6,6,8,-3,3,-13,-9,-5,0,-2,-2,7,-7,4,-1,5,3,8,-2,1,-2,-7,-2,-10,-8,5,-3,9,-14,-1,-3,-3,-2,4,-4,-2,-8,-2,0,-13,-18,-14,-9,-25,-7,-2,-5,-3,-1,0,6,-6,2,-14,-10,-1,-4,16,-19,3,-9,-1,-9,-20,-15,-1,7,-8,3,-4,8,-9,2,1,4,-5,0,-4,-21,3,0,3,-9,13,-9,6,-22,-3,0,-11,8,-7,18,-7,10,-1,-3,2,18,-8,28,-9,-6,-6,1,1,11,-15,23,-5,0,-1,-5,-16,-2,-3,-6,-7,-4,-14,-14,-9,-4,-3,-27,-11,-12,-5,5,-15,35,-5,27,-11,-3,-6,6,2,2,-1,2,-10,6,-5,7,-25,-2,-20,4,-5,7,-8,-4,-16,7,-7,12,-11,-1,4,-12,7,-5,3,-9,1,6,3,-1,1,-9,11,1,12,11,2,-11,10,-3,5,-6,-10,-11,-1,-6,-12,-9,-14,-4,-1,-4,-18,-8,-26,-7,-4,13,0,8,-17,22,-4,12,-5,3,-11,19,-3,0,2,8,-5,-10,-8,11,16,-29,0,-4,6,-6,3,-17,5,-3,4,-10,21,-18,-3,-3,9,-7,33,8,-1,-7,-16,-32,-38,-34,-5,-10,-2,-7,3,-4,-1,-8,6,-12,2,-19,-4,-8,-26,-18,4,-11,-1,-11,-14,-8,2,-2,-3,-11,-12,-14,-9,-8,-12,-6,-16,1,-15,-5,-7,5,0,11,-15,23,-5,24,-12,21,2,18,7,12,0,6,-4,8,2,3,-6,18,-16,19,5,21,-6,9,-8,-2,-6,-1,-7,10,-9,0,-23,-7,-13,2,-17,-4,-22,14,-12,18,-9,7,-1,7,-4,6,6,7,1,10,-4,18,13,22,24,19,-1,6,2,7,12,8,5,8,19,-3,18,7,41,4,3,-1,0,-2,5,1,-3,-3,2,-4,-3,-9,24,-8,3,-4,16,-6,5,4,1,6,7,3,37,-10,10,4,5,-3,9,0,4,3,7,15,1,10,-7,1,-11,-3,-4,2,-11,-2,-10,2,-6,8,2,4,-3,2,5,5,8,0,2,4,10,-1,12,5,8,0,16,-5,10,0,7,5,-2,3,-24,13,8,5,-3,2,8,3,-21,-5,0,-3,8,-1,-1,-1,-13,-4,-2,1,1,2,-6,2,6,2,-2,1,-12,3,-6,-8,-4,0,-6,-12,6,-8,-6,0,-6,-4,-2,3,-5,1,-6,-2,3,-2,-3,-1,-6,1,7,-13,-4,2,1,-3,-3,0,2,-5,-4,0,-4,2,-2,8,-9,9,1,8,-18,9,-5,7,-5,-1,0,4,-4,1,-4,-2,1,-7,13,-10,4,0,-1,-2,13,-7,-1,-2,-7,3,-2,-3,4,-2,-1,-2,-4,-5,-3,0,3,5,-4,5,-16,9,-8,6,-2,5,-7,2,-11,-6,-17,-1,-1,-6,-11,-4,-5,-8,2,-3,-12,-11,-11,0,-5,-3,-6,5,-11,-1,0,7,-4,3,4,10,-3,11,7,4,30,-2,3,3,1,10,-9,8,-7,2,-1,3,15,0,-2,6,5,-2,12,4,1,4,11,3,5,7,17,3,3,2,-3,8,2,8,10,3,-2,-5,4,-2,-7,-5,2,-4,5,-3,8,2,8,-3,17,5,10,-2,8,4,-1,8,3,3,5,2,4,-4,4,0,1,7,-5,1,0,3,23,1,6,3,-6,3,-26,-4,-7,5,1,5,-3,4,3,3,19,10,-7,4,-9,-1,-5,-4,1,-3,-18,-8,-3,-7,8,-7,-5,-5,-5,-1,-5,-13,-6,0,-3,-4,-5,0,-13,20,-10,-5,-7,-2,-7,3,-3,17,28,12,21,17,22,10,19,2,8,4,18,1,15,-4,-6,-1,6,-3,5,2,40,-10,5,-6,-6,-3,-8,-1,-26,3,8,-3,1,-8,10,-3,-2,5,3,2,12,-3,4,1,-3,3,11,5,10,-2,3,4,-5,3,3,3,-4,3,14,-2,3,-3,-6,0,0,-3,4,-2,37,11,3,0,-5,-3,27,3,6,-3,5,4,-5,3,3,1,40,-9,3,3,-11,4,1,3,-3,5,17,10,13,-1,1,-3,-5,-4,5,-5,-1,-7,5,-3,-12,-10,6,-1,13,8,-3,3,3,3,-6,0,-1,3,4,5,-6,4,8,4,-1,3,5,-3,-2,-4,6,-1,-2,3,8,2,19,-2,-4,4,0,5,31,2,-4,2,6,4,68,6,6,4,12,2,8,-1,-6,-1,11,-1,1,-3,19,2,16,-5,-2,-2,-22,-6,18,-1,3,-3,10,2,38,-4,0,4,19,-1,8,-3,2,-3,-3,-2,14,-6,5,5,8,-2,30,0,-3,5,6,2,46,-3,17,-7,30,0,4,-2,0,-3,6,-2,34,1,9,-5,6,2,-4,3,2,2,41,-3,-1793,-2;-478,346,-14,-1,-7,2,4,2,4,2,13,-5;-453,347,0,-5,7,4,6,-3,-2,-4,5,-3,9,8,0,5,15,-1,7,-2,-4,-5,4,-3,-1,-2,-10,-4,-12,1,-8,-9,-13,-4,-4,-2,0,-3,-12,-5,-5,-6,-2,-9,7,-1,5,-9,7,1,29,-9,14,-1,0,-10,11,-10,7,7,-6,10,8,3,8,7,-4,7,-6,4,6,5,-4,13,22,0,12,-6,9,-1,2,-10,8,-4,7,3,8,8,16,-17,-2,-3,22,-9,2,-4,6,-3,1,-5,-22,-10,-32,0,-24,-17,13,7,18,5,4,-2,-5,-4,4,-9,14,-2,5,6,4,-5,-28,-12,-4,0,0,4,9,4,-14,0,1,-2,-18,-9,-1,-3,4,-4,-19,-3,9,0,-10,-1,-5,-9,-3,2,3,-5,-5,-6,1,4,-3,6,0,-6,-3,1,3,-1,3,-12,-28,-21,0,-7,7,-16,-2,-8,-4,0,-3,3,-5,10,-1,7,-5,4,-6,-2,-6,4,-14,0,-2,-1,2,-5,-5,0,-18,3,-14,-7,-4,-5,1,-8,-3,-17,8,-15,9,-6,12,3,6,2,3,9,16,3,1,-4,-5,-13,-2,2,-1,-10,-3,-4,20,1,8,-4,-2,-20,8,-11,4,-1,9,4,14,-5,6,4,3,8,8,1,8,6,3,-1,-4,-4,2,-12,3,4,-2,6,6,2,1,4,9,-8,10,0,7,-3,2,3,13,1,-5,-2,2,-2,8,-3,1,-4,8,-3,9,-10,16,-1,13,-8,4,-11,3,-1,-3,-8,1,-1,9,-1,0,-5,4,3,14,-5,2,-5,6,1,17,-2,14,-10,8,-2,4,-11,-2,-8,-17,-20,-3,-24,-9,-21,-5,-5,-13,-2,-15,-7,-4,-5,-2,-14,-25,-29,-12,-2,-11,4,0,-2,6,-4,2,-9,-5,-6,-7,-3,-16,0,1,-9,-3,-2,-12,0,1,-5,6,0,2,-3,-9,-4,-2,-8,-8,-3,-2,-4,10,-4,-2,-5,-16,-13,5,-8,-13,-2,-3,-5,-18,8,-1,3,1,3,-3,12,7,8,-7,2,5,4,1,8,6,-1,2,10,-3,1,-2,-6,-3,1,6,20,-2,10,2,0,9,24,0,18,2,6,4,39,-1,7,-5,5,-23,14,-19,37,-7,5,1,3,-2,4,8,11,-6,2,0,6,5,9,6,3,2,6,6,6,-5,23,-7,3,-4,-5,2,-2,-4,-2,-1,3,-13,3,-7,8,-1,-2,-2,2,-1,5,-9,10,1,1,-19,4,-17,11,-10,-3,-34,13,-10,9,1,7,-4,7,-16,14,0,4,-15,13,-5,11,-3,2,-5,1,1,-8,15,-18,5,-12,6,-4,-3,-3,-11,10,-1,6,-13,9,4,4,-7,5,-8,17,-7,5,-10,3,-19,29,-1,12,3,14,-3,13,7,-1,3,-5,-1,10,-23,9,-2,8,-7,2,-1,4,-13,9,-10,14,-13,0,-16,7,-37,6,-5,-1,1,-3,-19,-4,2,8,5,1,-1,1,-17,-9,4,-3,-5,-3,-21,-11,-32,-8,35,16,4,7,-10,-3,-7,3,-8,-2,1,5,-10,1,-12,8,8,9,19,3,-4,3,4,2,-21,-2,-16,6,19,5,4,0,-1,-3,11,1,-26,11,3,2,15,3,6,5,27,5,11,-4,54,-2,35,-7,34,7,3,-2,5,3,12,-5,7,4,1,-4,14,2,31,-4,7,-3,-8,-2,27,0,6,-3,5,2,-5,3,3,1,10,1,24,-6,15,1,-1,3,5,1,7,-2,0,-5,4,4,4,0,2,5,-11,5,0,6,6,4,12,-3,6,-6,-4,-2,9,-2;-571,366,-2,-3,11,2,7,-3,5,3,9,-7,3,2,-4,5,15,-2,5,-8,17,-5,0,-2,-9,0,4,-2,-2,-2,-24,2,-31,-3,-14,3,-6,4,25,2,-28,1,-2,2,11,2,-16,1,8,6,18,2;-382,366,-17,-2,-5,3,2,2,20,-3;-433,366,4,-3,5,4,12,2,9,-5,-1,-4,15,4,18,-5,1,-2,9,1,21,-7,5,-5,-9,-2,35,-10,-11,-9,-14,7,-6,-1,-1,-3,14,-6,4,-5,-2,-4,-19,6,13,-9,-24,5,-19,8,-15,-2,-4,2,4,4,19,0,-1,2,8,7,-2,3,-19,5,3,2,-14,5,-12,-2,-36,3,-5,2,6,2,-7,0,-2,5,9,7,13,1,-4,-3;-502,369,16,-2,-4,-2,7,-2,-1,-5,-8,-2,-20,7,10,1,-6,3,6,2;-466,364,-5,-4,-6,0,-3,5,3,4,24,0,-13,-5;-602,357,-13,-2,-15,4,10,9,-5,3,17,1,20,-1,10,-4,-18,-4,-6,-6;-468,375,-10,-2,-6,2,3,2,7,1,6,-3;725,378,-4,-4,-26,-1,-10,3,3,4,6,1,31,-3;-492,384,3,-3,-2,-6,-13,0,0,3,-9,0,0,4,21,2;-541,381,12,-1,0,-3,-3,-2,-37,-3,0,2,10,2,-23,-1,-7,1,12,6,32,-5,-7,5,4,2,7,-3;288,354,-20,0,-10,3,-1,3,15,8,-4,1,12,4,-2,2,28,6,35,4,3,-2,-52,-11,-15,-10,1,-4,10,-4;-473,385,15,-1,4,-2,-1,-2,9,-2,40,1,6,-2,1,-2,-3,-2,-39,-1,-21,2,-2,5,-5,3,-17,2,2,2,11,-1;-581,388,-1,-4,-4,-1,-21,-4,-7,2,8,3,25,4;124,389,-12,-2,-8,1,3,2,-3,1,10,1,10,-3;-500,392,2,-2,-9,0,-19,2,5,1,-6,4,9,-1,18,-4;525,392,-28,-2,13,7,17,-3,-2,-2;91,399,17,-4,-13,-2,-9,-9,-17,3,4,2,-7,1,-14,8,33,2,6,-1;127,402,10,-2,-7,-2,-38,1,-5,3,15,1,25,-1;256,403,-18,-3,-5,1,2,2,-11,0,26,2,6,-2;500,394,-25,1,-19,7,24,4,21,-7,-1,-5;-435,398,6,-1,-25,-6,-16,3,4,3,-14,2,-4,2,13,4,-3,1,12,0,23,-4,4,-4;-342,416,33,-4,-29,-4,11,0,-29,-9,-29,-2,7,-1,-3,-1,4,-2,-22,-7,10,-2,-14,-3,-44,1,-1,3,9,1,-2,4,16,-2,-15,4,15,5,-10,4,26,1,-29,1,-20,6,31,4,11,-1,4,2,15,2,55,0;-135,418,31,-4,-53,-4,42,0,5,-1,-6,-3,37,4,18,-4,-39,-5,11,0,-10,-7,1,-6,6,-3,-16,-2,9,-3,1,-4,-5,0,6,-5,-11,0,6,-2,-2,-2,-14,0,6,-6,-12,1,13,-5,2,-4,-9,-1,-10,5,2,-3,-6,-3,20,0,-27,-9,-20,-1,-12,-8,-28,-6,-7,-10,-8,-4,2,-3,-5,-10,-7,0,-7,4,-10,0,-5,3,-12,11,-3,8,-7,5,1,3,-3,2,5,6,8,2,3,6,-13,-4,-6,2,1,6,15,-1,-22,5,5,5,-13,11,-19,7,-37,-1,-14,5,23,2,-21,1,-11,2,0,2,37,5,2,2,-13,2,39,9,36,-1,13,3,29,-4,-11,3,0,2,17,3,82,2";
const OUTLINE = [[51.98,19],[49.04,18.58],[48.17,18.16],[47.58,17.45],[47.44,17.11],[47.14,16.95],[46.98,16.95],[46.73,17.27],[45.54,17.3],[45.15,17.43],[43.92,17.32],[43.42,17.52],[43.19,17.36],[43.17,16.69],[42.8,16.37],[42.7,16.74],[42.39,17.12],[42.3,17.44],[41.75,17.88],[41.23,18.68],[41.12,19.08],[40.76,19.75],[40.08,20.27],[39.73,20.39],[39.27,20.97],[39.09,21.31],[39.15,21.52],[38.99,21.88],[39.06,22.59],[38.46,23.71],[37.92,24.18],[37.54,24.29],[37.18,24.82],[37.27,24.96],[37.15,25.29],[35.18,28.04],[34.72,28.13],[34.62,28.06],[34.95,29.35],[36.07,29.2],[36.48,29.5],[36.75,29.87],[37.47,30],[37.63,30.31],[37.98,30.5],[37.48,31.01],[36.96,31.49],[38.96,32],[39.14,32.13],[40.37,31.94],[42.08,31.08],[44.69,29.2],[47.43,28.99],[47.67,28.53],[48.44,28.54],[48.81,27.9],[48.8,27.72],[49.24,27.49],[49.17,27.44],[49.41,27.18],[50.15,26.66],[50.01,26.68],[50.22,26.31],[50.15,26.1],[50.03,26.11],[50.24,25.62],[50.46,25.42],[50.56,25.09],[50.93,24.59],[51.41,24.57],[51.31,24.34],[51.57,24.29],[51.59,24.08],[52.56,22.93],[55.1,22.62],[55.19,22.7],[55.64,22],[54.98,20],[51.98,19]];


// ---------------- PART 3: WHAT YOU SEE ----------------
// clues, the globe, the intro, the tabs, and some "hooks" so the page
// updates while part 1 is working.
// It's all inside (function () { ... })() so the names here don't mix up
// with part 1. It can still use part 1's stuff (picked, choice, charts, busy).
(function () {
    "use strict";     // catches typos in variable names

    // ---------- Small helpers ----------
    const $ = id => document.getElementById(id);
    const TAU = Math.PI * 2;
    const RAD = Math.PI / 180;
    const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
    const lerp = (a, b, k) => a + (b - a) * k;                       // a point between a and b
    const easeOut = k => 1 - Math.pow(1 - k, 3);                     // fast, then slows down
    const easeIn = k => k * k * k;                                   // slow, then speeds up
    const easeInOut = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const COLOR = { a: "#006b32", b: "#c98500", up: "#e66767", down: "#3987e5", flat: "#898781",
                    green: "#006b32", amber: "#ffb547", ink: "#0a1f13", panel: "#ffffff", grid: "rgba(10, 80, 45, 0.1)" };

    // --- the clues ---
    // one for each thing we look at. "suspect" is the label that flies
    // round the Earth in the intro; the rest goes in the Causes tab.
    const CLUES = [
        { code: "T2M", icon: "temp", name: "Air temperature", suspect: "Rising heat?", color: "#ff7a59",
          measures: "The temperature of the air 2 metres above the ground, from the MERRA-2 model.",
          cause: "Burning oil, gas and coal adds heat-trapping gases to the air, so the whole planet warms. Cities add more: concrete, asphalt and air-conditioner exhaust hold the heat in (the urban heat island).",
          fix: "Cleaner energy cuts the cause: Saudi Arabia aims for about half of its electricity from renewables by 2030 and net-zero emissions by 2060. In cities, trees, shade and light-coloured roofs cool the streets." },
        { code: "TS", icon: "ground", name: "Ground surface temperature", suspect: "Scorching ground?", color: "#ff9f43",
          measures: "How hot the ground itself gets (the \"skin\" of the Earth), which is often much hotter than the air.",
          cause: "Bare, dry, dark ground soaks up sunlight. When plants disappear or the soil dries out, there is no shade and no evaporation left to cool it.",
          fix: "Cover the ground: the Saudi Green Initiative plans 10 billion trees. Parks, reflective pavements and keeping native plants all lower the surface heat." },
        { code: "PRECTOTCORR", icon: "rain", name: "Rain", suspect: "Shifting rain?", color: "#5aa9ff",
          measures: "The average rainfall per day, from the corrected MERRA-2 rain.",
          cause: "Warmer air holds more water, so rain can arrive in fewer but heavier bursts. Desert rain also swings a lot from year to year by nature, which is why a real trend is hard to prove.",
          fix: "Prepare for both extremes: flood drains and early warnings for the bursts; dams, rain harvesting and careful water use for the dry spells." },
        { code: "RH2M", icon: "humidity", name: "Humidity", suspect: "Humidity shift?", color: "#6fd3ff",
          measures: "How much water vapour the air holds, compared with the most it could hold.",
          cause: "When the air warms faster than water is added to it, relative humidity drops inland. Near the Red Sea and the Gulf, warmer water evaporates more and makes the coast feel stickier.",
          fix: "Heat-and-humidity warnings, shaded and cooled public spaces, and rules such as the summer midday ban on outdoor work protect people when the air is dangerous." },
        { code: "WS2M", icon: "wind", name: "Wind speed", suspect: "Changing winds?", color: "#b8c4e0",
          measures: "The average wind speed 2 metres above the ground.",
          cause: "Winds follow pressure patterns that shift as the planet warms. New buildings and trees also slow the wind near the ground.",
          fix: "Use it and tame it: wind farms such as Dumat Al Jandal (400 MW) turn wind into clean power, while green belts of trees slow the wind that lifts dust." },
        { code: "ALLSKY_SFC_SW_DWN", icon: "sun", name: "Sunshine energy", suspect: "A dimmer sun?", color: "#ffd166",
          measures: "The solar energy that reaches the ground each day, measured with the CERES satellite instruments.",
          cause: "Dust, haze, pollution and clouds block sunlight. More dust means dimmer days; cleaner air means brighter ones.",
          fix: "Less dust and pollution keeps the sky clear, and that sunshine is a resource: solar plants such as Sakaka and Sudair already turn it into electricity." },
        { code: "GWETROOT", icon: "soil", name: "Soil wetness", suspect: "Drying soil?", color: "#c9a26b",
          measures: "How wet the soil is where roots grow, on a scale from 0 (bone dry) to 1 (soaked).",
          cause: "Hotter air pulls more water out of the soil, and rain is rare. Pumping groundwater and overgrazing leave the land drier still.",
          fix: "Drip irrigation, reusing treated wastewater, drought-tough native plants and resting grazing land all help the soil hold on to its water." },
        { code: "NDVI", icon: "leaf", name: "Plants", suspect: "Fading plants?", color: "#4cd98a", space: true,
          measures: "NDVI, a greenness index from the MODIS instrument: near 0 is bare ground, near 1 is thick green plants.",
          cause: "Drought, overgrazing and growing cities remove plants. Irrigated farms add green patches, but they depend on groundwater.",
          fix: "The Saudi Green Initiative aims to restore 40 million hectares of land and protect 30% of land and sea by 2030. Native species matter most, because they survive on little water." },
        { code: "SST", icon: "sea", name: "Sea temperature", suspect: "Warming seas?", color: "#3fb6e8", space: true,
          measures: "The temperature of the sea surface, from the MUR analysis that blends many satellites.",
          cause: "The oceans absorb about 90% of the extra heat trapped by greenhouse gases. The Red Sea and the Arabian Gulf are narrow and shallow, so they heat up quickly.",
          fix: "Cutting emissions is the main fix. Locally, protecting coral reefs and mangroves and creating marine reserves helps sea life cope with the heat." },
        { code: "CHL", icon: "flask", name: "Water quality", suspect: "Murky water?", color: "#7be0c3", space: true,
          measures: "Chlorophyll at the sea surface, a sign of how much algae is growing, seen by the Aqua satellite.",
          cause: "Nutrients from sewage, fertiliser and fish farms feed algae. Warm, still water lets the blooms grow.",
          fix: "Treat wastewater before it reaches the sea, manage what desalination and industry discharge, and watch for blooms from space so the coast can react early." },
        { code: "DUST", icon: "dust", name: "Dust in the air", suspect: "More dust storms?", color: "#e8b877", space: true,
          measures: "Aerosols (tiny particles such as dust) seen by the Terra satellite, drawn on top of a true-colour photo.",
          cause: "Strong winds lift dust from dry, bare soil. Drought and damaged land, here and in neighbouring countries, give the wind more to pick up.",
          fix: "Plants hold the soil down: green belts and restored rangeland cut dust at its source. The Middle East Green Initiative plans 50 billion trees across the region, and storm warnings give people time to prepare." }
    ];

    // Writes the HTML for one of the small drawings in index.html, for example icon("leaf")
    const icon = (name, size = 22) =>
        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${name}"/></svg>`;

    // --- the globe ---
    // We take a flat picture of the Earth and wrap it onto a ball: for each
    // pixel of the ball we work out its lat/lon and copy that colour.
    const K = 0.42;        // radius of the planet at zoom 1, as a share of the lens size
    const LENS = 0.47;     // radius of the round lens, as a share of its canvas
    const TW = 4096;       // texture width  (must stay 4096: the maths below uses >> 4)
    const TH = 2048;       // texture height (must stay 2048: the maths below uses >> 5)
    const KSA = { lat: 24 * RAD, lon: 45 * RAD };                    // the middle of Saudi Arabia
    const HOME = { lat0: KSA.lat, lon0: KSA.lon, zoom: 3 };          // the dashboard's starting view
    const BLUE_MARBLE = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326" +
                        "&BBOX=-90,-180,90,180&WIDTH=4096&HEIGHT=2048&FORMAT=image/jpeg&LAYERS=BlueMarble_ShadedRelief_Bathymetry";

    const globe = { S: 640, size: 0, zoom: 1, lat0: 10 * RAD, lon0: 5 * RAD, hl: 0,
                    dirty: true, mapDirty: true, lowQ: false, moved: 0, sphere: document.createElement("canvas") };
    let tex = null;                                  // the texture's colours (the 4th number of each pixel says "inside Saudi Arabia")
    let sctx = null, simg = null;                    // where the ball is painted
    let mPix, mLon, mLat, mShade, mAlpha, mN = 0;    // the look-up table: one entry per pixel of the ball

    // A simple drawn Earth, used until (or if) NASA's photo cannot be loaded
    function paintFallback() {
        const w = 2048, h = 1024;
        const land = document.createElement("canvas"); land.width = w; land.height = h;
        const g = land.getContext("2d");
        g.fillStyle = "#3d7a55";
        LAND.split(";").forEach(ring => {                            // LAND is a compact list of coastline points
            const n = ring.split(",").map(Number);
            let x = 0, y = 0;
            g.beginPath();
            for (let i = 0; i < n.length; i += 2) {
                x += n[i]; y += n[i + 1];
                const px = (x / 5 + 180) / 360 * w, py = (90 - y / 5) / 180 * h;
                if (i == 0) { g.moveTo(px, py); } else { g.lineTo(px, py); }
            }
            g.closePath(); g.fill();
        });
        g.globalCompositeOperation = "source-atop";                  // from here on, paint only on top of land
        let sand = g.createLinearGradient(0, h * 0.28, 0, h * 0.46);  // the desert belt
        sand.addColorStop(0, "rgba(201,167,115,0)"); sand.addColorStop(0.3, "rgba(201,167,115,0.95)");
        sand.addColorStop(0.7, "rgba(201,167,115,0.95)"); sand.addColorStop(1, "rgba(201,167,115,0)");
        g.fillStyle = sand; g.fillRect(w * 0.44, 0, w * 0.27, h);
        g.fillStyle = "#e9eef5"; g.fillRect(0, 0, w, h * 0.1); g.fillRect(0, h * 0.84, w, h);   // ice

        const base = document.createElement("canvas"); base.width = w; base.height = h;
        const b = base.getContext("2d");
        const sea = b.createLinearGradient(0, 0, 0, h);
        sea.addColorStop(0, "#0a2850"); sea.addColorStop(0.5, "#0d3d78"); sea.addColorStop(1, "#0a2850");
        b.fillStyle = sea; b.fillRect(0, 0, w, h);
        b.drawImage(land, 0, 0);
        return base;
    }

    // Turns a picture into the texture, and marks which pixels are inside Saudi Arabia
    function buildTexture(picture) {
        const c = document.createElement("canvas"); c.width = TW; c.height = TH;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(picture, 0, 0, TW, TH);
        let data;
        try { data = g.getImageData(0, 0, TW, TH).data; } catch (error) { return false; }
        for (let i = 3; i < data.length; i += 4) { data[i] = 0; }    // 0 = not Saudi Arabia

        // Draw the border as a filled shape on a small canvas and copy it in
        const x0 = Math.floor((34 + 180) / 360 * TW), x1 = Math.ceil((56.5 + 180) / 360 * TW);
        const y0 = Math.floor((90 - 33) / 180 * TH), y1 = Math.ceil((90 - 16) / 180 * TH);
        const m = document.createElement("canvas"); m.width = x1 - x0; m.height = y1 - y0;
        const mg = m.getContext("2d");
        mg.fillStyle = "#fff"; mg.beginPath();
        OUTLINE.forEach((p, i) => {
            const x = (p[0] + 180) / 360 * TW - x0, y = (90 - p[1]) / 180 * TH - y0;
            if (i == 0) { mg.moveTo(x, y); } else { mg.lineTo(x, y); }
        });
        mg.closePath(); mg.fill();
        const md = mg.getImageData(0, 0, m.width, m.height).data;
        for (let y = 0; y < m.height; y++) {
            for (let x = 0; x < m.width; x++) {
                if (md[(y * m.width + x) * 4] > 127) { data[((y + y0) * TW + x + x0) * 4 + 3] = 255; }
            }
        }
        tex = data; globe.dirty = true;
        return true;
    }

    // Builds the look-up table: for each pixel of the ball, which latitude / longitude it shows
    function buildMap(s) {
        globe.size = s;
        globe.sphere.width = globe.sphere.height = s;
        sctx = globe.sphere.getContext("2d");
        simg = sctx.createImageData(s, s);
        if (!mPix || mPix.length < s * s) {
            mPix = new Int32Array(s * s); mLon = new Uint16Array(s * s); mLat = new Uint16Array(s * s);
            mShade = new Uint8Array(s * s); mAlpha = new Uint8Array(s * s);
        }
        const R = s * K * globe.zoom, c = s / 2, clip = s * LENS * s * LENS;
        const sinT = Math.sin(globe.lat0), cosT = Math.cos(globe.lat0);
        const ambient = lerp(0.1, 0.5, clamp((globe.zoom - 1) / 1.2));   // zoomed in = evenly lit
        let k = 0;
        for (let py = 0; py < s; py++) {
            const dy = py + 0.5 - c, y = -dy / R;
            for (let px = 0; px < s; px++) {
                const dx = px + 0.5 - c;
                if (dx * dx + dy * dy > clip) { continue; }          // outside the lens
                const x = dx / R, d = x * x + y * y;
                if (d >= 1) { continue; }                            // outside the planet
                const z = Math.sqrt(1 - d);                          // how far this point bulges towards us
                const gy = y * cosT + z * sinT, gz = -y * sinT + z * cosT;   // undo the tilt
                const lat = Math.asin(gy), dl = Math.atan2(x, gz);
                mPix[k] = (py * s + px) << 2;
                mLat[k] = Math.min(65535, (0.5 - lat / Math.PI) * 65536);
                mLon[k] = ((dl / TAU + 1) * 65536) & 65535;
                const light = Math.max(0, -0.42 * x + 0.40 * y + 0.81 * z);              // the sun is up and to the left
                mShade[k] = Math.min(255, 256 * (ambient + (1.02 - ambient) * light) * (0.62 + 0.38 * z));
                mAlpha[k] = Math.min(255, (1 - Math.sqrt(d)) * R * 255);                 // a soft edge
                k++;
            }
        }
        mN = k; globe.mapDirty = false; globe.dirty = true;
    }

    // Paints the ball. Turning the globe only shifts the longitude, so this is very fast.
    function renderSphere() {
        const out = simg.data;
        const turn = Math.round((globe.lon0 / TAU + 0.5) * 65536) & 65535;
        const hl = Math.round(globe.hl * 256);                       // how strongly Saudi Arabia is picked out
        for (let i = 0; i < mN; i++) {
            const u = (mLon[i] + turn) & 65535;
            const t = ((mLat[i] >> 5) * TW + (u >> 4)) << 2;
            let r = tex[t], g = tex[t + 1], b = tex[t + 2];
            if (hl) {
                if (tex[t + 3]) {                                    // inside Saudi Arabia: a little brighter
                    r += ((255 - r) * hl) >> 11; g += ((255 - g) * hl) >> 11; b += ((255 - b) * hl) >> 11;
                } else {                                             // the rest of the world: dim and bluish
                    const grey = (r * 77 + g * 150 + b * 29) >> 8;
                    r += ((((grey * 82) >> 8) + 4 - r) * hl) >> 8;
                    g += ((((grey * 100) >> 8) + 8 - g) * hl) >> 8;
                    b += ((((grey * 150) >> 8) + 20 - b) * hl) >> 8;
                }
            }
            const shade = mShade[i], o = mPix[i];
            out[o] = (r * shade) >> 8; out[o + 1] = (g * shade) >> 8; out[o + 2] = (b * shade) >> 8; out[o + 3] = mAlpha[i];
        }
        sctx.putImageData(simg, 0, 0);
    }

    // Changes the view. While the zoom or tilt is moving, the ball is painted at half size to stay smooth.
    function setGlobe(view, now) {                                  // copy the new view in; note what needs redrawing
        for (const key of ["lon0", "lat0", "zoom", "hl"]) {
            if (view[key] == undefined || Math.abs(view[key] - globe[key]) < 1e-7) { continue; }
            globe[key] = view[key]; globe.dirty = true;
            if (key == "zoom" || key == "lat0") { globe.mapDirty = true; globe.lowQ = true; globe.moved = now; }
        }
    }
    // Rebuilds the look-up table and repaints the ball only when something changed (saves a lot of work)
    function updateGlobe(now) {
        if (!tex) { return; }
        if (globe.lowQ && now - globe.moved > 200) { globe.lowQ = false; globe.mapDirty = true; }
        const s = globe.lowQ ? globe.S >> 1 : globe.S;
        if (globe.mapDirty || s != globe.size) { buildMap(s); }
        if (globe.dirty) { renderSphere(); globe.dirty = false; }
    }

    // Where a place (latitude, longitude) sits on the ball. z > 0 means it faces us.
    function proj(lat, lon, lat0, lon0) {
        const dl = lon - lon0, cl = Math.cos(lat);
        const x = cl * Math.sin(dl), y = Math.sin(lat), z = cl * Math.cos(dl);
        const s = Math.sin(lat0), c = Math.cos(lat0);
        return { x: x, y: y * c - z * s, z: y * s + z * c };
    }
    const project = (lat, lon) => proj(lat, lon, globe.lat0, globe.lon0);

    // ---------- The hotspots: one for each city in the City A list ----------
    const spots = Array.from($("cityA").options).map(option => {
        const p = option.value.split(",");
        return { name: option.text, value: option.value, lat: p[0] * RAD, lon: p[1] * RAD, r: null, pending: false, sx: 0, sy: 0, vis: false };
    });
    const spotByName = {};
    spots.forEach(s => { spotByName[s.name] = s; });
    let spotsKey = "";       // which case (variable, months, years, source) the hotspot colours belong to
    let hover = null;        // the hotspot under the mouse

    function drawSpots(ctx, gx, gy, D, Rd, u, now, alpha) {
        const nameA = picked("cityA").text, nameB = picked("cityB").text;       // picked() comes from the backend
        ctx.save(); ctx.globalAlpha = alpha;
        spots.forEach((s, i) => {
            const p = project(s.lat, s.lon);
            s.sx = gx + p.x * Rd; s.sy = gy - p.y * Rd;
            s.vis = p.z > 0.08 && Math.hypot(s.sx - gx, s.sy - gy) < D * LENS - 4 * u;
            if (!s.vis) { return; }

            let color = COLOR.amber, pulse = 0.45;                   // not tested yet
            if (s.r && s.r.real && s.r.S > 0) { color = COLOR.up; pulse = 1; }
            else if (s.r && s.r.real) { color = COLOR.down; pulse = 1; }
            else if (s.r) { color = "#b9c0d0"; pulse = 0; }

            if (pulse > 0 && !calm) {                                // a ring that grows and fades
                const phase = (now / 1000 * 0.8 + i * 0.17) % 1;
                ctx.strokeStyle = color; ctx.lineWidth = 1.6 * u; ctx.globalAlpha = alpha * (1 - phase) * 0.8 * pulse;
                ctx.beginPath(); ctx.arc(s.sx, s.sy, (4 + 15 * phase) * u, 0, TAU); ctx.stroke();
                ctx.globalAlpha = alpha;
            }
            if (s.pending) {                                         // being tested right now: a spinning arc
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * u;
                ctx.beginPath(); ctx.arc(s.sx, s.sy, 9 * u, now / 140, now / 140 + 4); ctx.stroke();
            }
            const glow = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, 10 * u);
            glow.addColorStop(0, color); glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.globalAlpha = alpha * 0.45; ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(s.sx, s.sy, 10 * u, 0, TAU); ctx.fill();
            ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.strokeStyle = "#04060f"; ctx.lineWidth = 1.2 * u;
            ctx.beginPath(); ctx.arc(s.sx, s.sy, 3.6 * u, 0, TAU); ctx.fill(); ctx.stroke();
            if (s == hover) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.arc(s.sx, s.sy, 7 * u, 0, TAU); ctx.stroke(); }
        });

        // Rings and names for City A and City B
        [[nameA, COLOR.green], [nameB, COLOR.amber]].forEach((pair, i) => {
            const s = spotByName[pair[0]];
            if (!s || !s.vis || (i == 1 && nameA == nameB)) { return; }
            ctx.strokeStyle = pair[1]; ctx.lineWidth = 2.4 * u;
            ctx.beginPath(); ctx.arc(s.sx, s.sy, 12 * u, 0, TAU); ctx.stroke();
            const left = s.sx > gx + D * 0.16;
            ctx.font = `600 ${13 * u}px system-ui, sans-serif`; ctx.textBaseline = "middle"; ctx.textAlign = left ? "right" : "left";
            ctx.lineWidth = 4 * u; ctx.strokeStyle = "rgba(4,6,15,0.9)"; ctx.lineJoin = "round";
            ctx.strokeText(s.name, s.sx + (left ? -17 : 17) * u, s.sy);
            ctx.fillStyle = "#fff"; ctx.fillText(s.name, s.sx + (left ? -17 : 17) * u, s.sy);
        });
        ctx.restore();
    }

    // Draws the whole lens: glow, planet, Saudi border, hotspots, and the ring around it.
    // gx, gy = the middle. D = the size. Used by both the intro and the dashboard.
    function drawGlobe(ctx, gx, gy, D, o) {
        const Rd = D * K * globe.zoom, u = D / 350, far = Rd < D * 0.56;

        if (far) {                                                   // the blue glow of the atmosphere
            const g = ctx.createRadialGradient(gx, gy, Rd * 0.96, gx, gy, Rd * 1.19);
            g.addColorStop(0, "rgba(90,170,255,0.55)"); g.addColorStop(0.35, "rgba(70,150,255,0.18)"); g.addColorStop(1, "rgba(70,150,255,0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, Rd * 1.19, 0, TAU); ctx.fill();
        }

        ctx.save();
        ctx.beginPath(); ctx.arc(gx, gy, D * LENS, 0, TAU); ctx.clip();
        ctx.drawImage(globe.sphere, gx - D / 2, gy - D / 2, D, D);

        if (far) {                                                   // light along the edge of the planet
            const g = ctx.createRadialGradient(gx, gy, Rd * 0.72, gx, gy, Rd);
            g.addColorStop(0, "rgba(120,190,255,0)"); g.addColorStop(1, "rgba(120,190,255,0.3)");
            ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(gx, gy, Rd, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        }

        const border = o.border == undefined ? globe.hl : o.border;
        if (border > 0.01) {                                         // the border of Saudi Arabia, in gold
            ctx.beginPath();
            let pen = false;
            for (let i = 0; i < OUTLINE.length; i++) {
                const p = project(OUTLINE[i][1] * RAD, OUTLINE[i][0] * RAD);
                if (p.z <= 0.02) { pen = false; continue; }
                if (pen) { ctx.lineTo(gx + p.x * Rd, gy - p.y * Rd); } else { ctx.moveTo(gx + p.x * Rd, gy - p.y * Rd); pen = true; }
            }
            ctx.strokeStyle = `rgba(255,196,92,${0.95 * border})`; ctx.lineWidth = 1.7 * u; ctx.lineJoin = "round";
            ctx.shadowColor = "rgba(255,181,71,0.9)"; ctx.shadowBlur = 9 * u; ctx.stroke(); ctx.shadowBlur = 0;
        }

        if (o.hot > 0.01) { drawSpots(ctx, gx, gy, D, Rd, u, o.now, o.hot); }

        if (o.ring > 0.01) {                                         // the lens gets darker towards its edge
            const g = ctx.createRadialGradient(gx, gy, D * 0.33, gx, gy, D * LENS);
            g.addColorStop(0, "rgba(4,6,15,0)"); g.addColorStop(1, `rgba(4,6,15,${0.62 * o.ring * clamp(globe.zoom - 1)})`);
            ctx.fillStyle = g; ctx.fillRect(gx - D / 2, gy - D / 2, D, D);
        }
        ctx.restore();

        if (o.ring > 0.01) {                                         // the ring of the magnifying lens
            ctx.save(); ctx.globalAlpha = o.ring;
            const g = ctx.createLinearGradient(gx - D / 2, gy - D / 2, gx + D / 2, gy + D / 2);
            g.addColorStop(0, COLOR.green); g.addColorStop(1, "#7ddc9c");     // green ring
            ctx.strokeStyle = g; ctx.lineWidth = 3 * u; ctx.shadowColor = "rgba(0,132,61,0.6)"; ctx.shadowBlur = 9 * u;
            ctx.beginPath(); ctx.arc(gx, gy, D * LENS, 0, TAU); ctx.stroke();
            if (o.sweep) {                                           // a bright arc circling while cities are scanned
                const a = o.now / 420;
                ctx.strokeStyle = COLOR.amber; ctx.shadowColor = COLOR.amber; ctx.lineWidth = 4.5 * u; ctx.lineCap = "round";
                ctx.beginPath(); ctx.arc(gx, gy, D * LENS, a, a + 0.9); ctx.stroke();
            }
            ctx.restore();
        }
    }

    // --- the intro ---
    // drawn on one big canvas. T = seconds since it started, TL = when each part starts.
    const TL = { meteor: 1.2, impact: 3.5, orbit: 3.7, title: 5.3, converge: 9.0, zoom0: 9.5, zoom1: 11.3, fly0: 11.4, fly1: 12.7 };
    const CAPTIONS = [
        [0.5, "Satellites have been watching Saudi Arabia for over 40 years."],
        [3.9, "But is anything actually changing?"],
        [5.9, "Here are 11 things that might be."],
        [9.1, "Real change, or just normal ups and downs? Let's check."],
        [11.4, ""]
    ];
    const ORBIT = { r: [1.42, 1.74, 2.04], tilt: [20 * RAD, 26 * RAD, 17 * RAD], turn: [-16 * RAD, 10 * RAD, 30 * RAD], speed: [0.82, 0.62, 0.5] };

    const film = $("introCanvas"), fx = film.getContext("2d");
    const hero = $("globe"), hx = hero.getContext("2d");
    const intro = { on: false, hold: true, T: 0, last: 0, t0: 0, sparks: [], debris: [], boom: false, cap: -1,
                    W: 0, H: 0, dpr: 1, sky: null, twinkle: [], P0: null, P1: null, PC: null };

    function sizeIntro() {
        const W = intro.W = innerWidth, H = intro.H = innerHeight;
        const dpr = intro.dpr = Math.min(devicePixelRatio || 1, 1.5);
        film.width = Math.round(W * dpr); film.height = Math.round(H * dpr);

        // The sky is painted once: darkness, two faint clouds of colour, and many stars
        const sky = intro.sky = document.createElement("canvas"); sky.width = film.width; sky.height = film.height;
        const g = sky.getContext("2d"); g.scale(dpr, dpr);
        g.fillStyle = "#000"; g.fillRect(0, 0, W, H);      // space black
        const count = Math.round(W * H / 2600);
        for (let i = 0; i < count; i++) {
            const size = Math.random() < 0.9 ? Math.random() * 1.1 + 0.3 : Math.random() * 1.2 + 1.2;
            g.fillStyle = ["#ffffff", "#ffffff", "#fff4e0", "#e6efff"][i % 4];   // mostly white, a few warm and cool
            g.globalAlpha = Math.random() * 0.7 + 0.2;
            g.beginPath(); g.arc(Math.random() * W, Math.random() * H, size * 0.6, 0, TAU); g.fill();
        }
        intro.twinkle = [];
        for (let i = 0; i < 150; i++) { intro.twinkle.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2 + 0.6, ph: Math.random() * TAU, sp: Math.random() * 2 + 0.8, big: Math.random() < 0.25 }); }

        // The shooting star's path: from beyond the top-right corner to Saudi Arabia, bending down
        const D = lensSize(), view = introView(TL.impact);
        const p = proj(KSA.lat, KSA.lon, view.lat0, view.lon0);
        intro.P1 = { x: W / 2 + p.x * D * K, y: H * 0.56 - p.y * D * K };
        intro.P0 = { x: W + 90, y: -H * 0.18 };
        const dx = intro.P1.x - intro.P0.x, dy = intro.P1.y - intro.P0.y;
        intro.PC = { x: intro.P0.x + dx * 0.55 - dy * 0.14, y: intro.P0.y + dy * 0.55 + dx * 0.14 };
    }
    const lensSize = () => Math.min(intro.W * 0.84, intro.H * 0.6);

    // How the globe is turned, tilted and zoomed at time T
    function introView(T) {
        const drift = 5 + 1.2 * Math.min(T, TL.converge);
        const k = easeInOut(clamp((T - TL.converge) / 2));
        return { lon0: lerp(drift, 45, k) * RAD, lat0: lerp(10, 24, k) * RAD,
                 zoom: lerp(1, HOME.zoom, easeInOut(clamp((T - TL.zoom0) / (TL.zoom1 - TL.zoom0)))),
                 hl: clamp((T - TL.zoom0 - 0.2) / 1.4) };
    }

    // A point on the shooting star's curved path (s goes from 0 to 1)
    function path(s) {
        const a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s;
        return { x: a * intro.P0.x + b * intro.PC.x + c * intro.P1.x, y: a * intro.P0.y + b * intro.PC.y + c * intro.P1.y };
    }

    // A point on one of the three tilted orbits (z > 0 means in front of the planet)
    function orbitPoint(radius, angle, ring) {
        const x0 = radius * Math.cos(angle), z0 = radius * Math.sin(angle);
        const y1 = z0 * Math.sin(ORBIT.tilt[ring]), z1 = z0 * Math.cos(ORBIT.tilt[ring]);
        const c = Math.cos(ORBIT.turn[ring]), s = Math.sin(ORBIT.turn[ring]);
        return { x: x0 * c - y1 * s, y: x0 * s + y1 * c, z: z1 };
    }

    // Draws the front half or the back half of one orbit ring (the back half goes behind the planet)
    function drawOrbitHalf(gx, gy, radius, ring, front, alpha) {
        fx.beginPath();
        let pen = false;
        for (let i = 0; i <= 96; i++) {
            const p = orbitPoint(radius, i / 96 * TAU, ring);
            if ((p.z >= 0) != front) { pen = false; continue; }
            if (pen) { fx.lineTo(gx + p.x, gy + p.y); } else { fx.moveTo(gx + p.x, gy + p.y); pen = true; }
        }
        fx.strokeStyle = `rgba(210,240,222,${alpha})`; fx.lineWidth = 1; fx.stroke();
    }

    // Draws one glowing clue (orb) and its name label
    function drawOrb(o, gx, scale) {
        const dim = o.z < 0 ? 0.55 : 1, a = o.a * dim;
        if (a < 0.02) { return; }
        const size = 5.5 * scale * o.s * (1 + 0.2 * o.z);
        const glow = fx.createRadialGradient(o.x, o.y, 0, o.x, o.y, size * 4.2);
        glow.addColorStop(0, o.c.color); glow.addColorStop(1, "rgba(0,0,0,0)");
        fx.globalCompositeOperation = "lighter"; fx.globalAlpha = a * 0.7; fx.fillStyle = glow;
        fx.beginPath(); fx.arc(o.x, o.y, size * 4.2, 0, TAU); fx.fill();
        fx.globalCompositeOperation = "source-over"; fx.globalAlpha = a; fx.fillStyle = "#fff";
        fx.beginPath(); fx.arc(o.x, o.y, size * 0.75, 0, TAU); fx.fill();

        // The label: a dark pill with the suspect's name
        const la = a * o.label;
        if (la > 0.03) {
            fx.font = `600 ${Math.round(13 * scale)}px system-ui, sans-serif`;
            const w = fx.measureText(o.c.suspect).width + 20 * scale, h = 24 * scale;
            const left = o.x < gx, y = o.y - h / 2;
            const x = clamp(left ? o.x - size * 2 - w : o.x + size * 2, 6, intro.W - w - 6);
            fx.globalAlpha = la;
            fx.fillStyle = "rgba(5,9,20,0.8)"; fx.strokeStyle = o.c.color; fx.lineWidth = 1;
            fx.beginPath();
            if (fx.roundRect) { fx.roundRect(x, y, w, h, h / 2); } else { fx.rect(x, y, w, h); }     // older browsers: plain corners
            fx.fill(); fx.stroke();
            fx.fillStyle = "#eef3ff"; fx.textBaseline = "middle"; fx.textAlign = "left";
            fx.fillText(o.c.suspect, x + 10 * scale, o.y + 0.5);
        }
        fx.globalAlpha = 1;
    }

    // where the Terra satellite is at time T. Terra goes over the poles, north to south
    // on the day side, so we draw its path as a tall loop. cx, cy = planet centre.
    function terraPoint(T, r, cx, cy) {
        const tilt = 35 * RAD;                                     // how much of the loop we see from the side
        const at = a => ({ x: cx + r * Math.cos(a) * Math.sin(tilt), y: cy - r * Math.sin(a), z: Math.cos(a) * Math.cos(tilt) });
        const a = Math.PI / 2 - 0.55 * T;                          // starts over the North Pole and moves south
        const p = at(a), next = at(a - 0.02);                      // where it is now, and a moment later
        p.dir = Math.atan2(next.y - p.y, next.x - p.x);            // the direction it is flying
        return p;
    }

    // draws Terra: gold body, one big solar panel (the real one has a single wing),
    // a small dish, and its name when it's in front of the planet
    function drawTerra(p, scale, alpha, label) {
        if (alpha < 0.02) { return; }
        const u = 8 * scale;                                       // the size unit of the drawing
        fx.save();
        fx.globalAlpha = alpha;
        fx.translate(p.x, p.y); fx.rotate(p.dir);                  // point the drawing the way it is flying
        fx.strokeStyle = "#cfd6e4"; fx.lineWidth = Math.max(1, 0.25 * u);
        fx.beginPath(); fx.moveTo(-0.8 * u, 0); fx.lineTo(-1.6 * u, 0); fx.stroke();       // the arm that holds the panel
        fx.fillStyle = "#1f4fa8"; fx.fillRect(-5 * u, -1.1 * u, 3.4 * u, 2.2 * u);           // the solar panel
        fx.strokeStyle = "rgba(170,205,255,0.85)"; fx.lineWidth = 1;
        fx.strokeRect(-5 * u, -1.1 * u, 3.4 * u, 2.2 * u);
        fx.beginPath();                                            // the grid of solar cells
        for (let i = 1; i < 4; i++) { fx.moveTo(-5 * u + i * 0.85 * u, -1.1 * u); fx.lineTo(-5 * u + i * 0.85 * u, 1.1 * u); }
        fx.moveTo(-5 * u, 0); fx.lineTo(-1.6 * u, 0); fx.stroke();
        fx.fillStyle = "#d9a441"; fx.fillRect(-0.8 * u, -0.7 * u, 2 * u, 1.4 * u);          // the body, wrapped in gold foil
        fx.fillStyle = "rgba(255,240,200,0.55)"; fx.fillRect(-0.8 * u, -0.7 * u, 2 * u, 0.4 * u);   // light on its top edge
        fx.fillStyle = "#eef2f8"; fx.beginPath(); fx.arc(1.6 * u, 0, 0.45 * u, 0, TAU); fx.fill();  // the antenna dish
        fx.restore();

        if (label) {                                               // the name tag, kept level (not rotated)
            const text = "Terra satellite \u00b7 launched 1999";
            fx.font = `600 ${Math.round(12 * scale)}px system-ui, sans-serif`;
            const w = fx.measureText(text).width + 18 * scale, h = 22 * scale;
            const x = clamp(p.x + 4 * u, 6, intro.W - w - 6), y = p.y - 4 * u - h / 2;
            fx.save(); fx.globalAlpha = alpha;
            fx.fillStyle = "rgba(5,9,20,0.8)"; fx.strokeStyle = "#d9a441"; fx.lineWidth = 1;
            fx.beginPath();
            if (fx.roundRect) { fx.roundRect(x, y, w, h, h / 2); } else { fx.rect(x, y, w, h); }
            fx.fill(); fx.stroke();
            fx.fillStyle = "#eef3ff"; fx.textBaseline = "middle"; fx.textAlign = "left";
            fx.fillText(text, x + 9 * scale, y + h / 2 + 0.5);
            fx.restore();
        }
    }

    // A circle drawn ON the surface of the planet, used for the shock waves
    function shockRing(centre, angle, gx, gy, Rs, color, width) {
        // two directions at right angles to the centre point
        let ux = -centre.y, uy = centre.x, uz = 0;
        const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        const vx = centre.y * uz - centre.z * uy, vy = centre.z * ux - centre.x * uz, vz = centre.x * uy - centre.y * ux;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        fx.beginPath();
        let pen = false;
        for (let i = 0; i <= 72; i++) {
            const t = i / 72 * TAU, ct = Math.cos(t), st = Math.sin(t);
            const x = ca * centre.x + sa * (ct * ux + st * vx), y = ca * centre.y + sa * (ct * uy + st * vy), z = ca * centre.z + sa * (ct * uz + st * vz);
            if (z <= 0) { pen = false; continue; }
            if (pen) { fx.lineTo(gx + x * Rs, gy - y * Rs); } else { fx.moveTo(gx + x * Rs, gy - y * Rs); pen = true; }
        }
        fx.strokeStyle = color; fx.lineWidth = width; fx.stroke();
    }

    // Shows the caption for time T, fading the old one out first
    function setCaption(T) {
        let index = -1;
        for (let i = 0; i < CAPTIONS.length; i++) { if (T >= CAPTIONS[i][0]) { index = i; } }
        if (index == intro.cap) { return; }
        intro.cap = index;
        const box = $("caption");
        box.classList.remove("show");
        setTimeout(() => { if (intro.cap == index && index >= 0) { box.textContent = CAPTIONS[index][1]; box.classList.toggle("show", CAPTIONS[index][1] != ""); } }, 380);
    }

    // Draws one frame of the film
    function introFrame(now) {
        const W = intro.W, H = intro.H;
        const dt = intro.hold ? 0 : Math.min(0.05, (now - intro.last) / 1000);
        intro.last = now; intro.T += dt;
        const T = intro.T;
        if (T >= TL.fly1) { endIntro(); return; }

        const view = introView(T);
        setGlobe(view, now); updateGlobe(now);

        // Where the lens is. At the very end it flies to its place in the dashboard.
        let gx = W / 2, gy = H * 0.56, D = lensSize(), rest = 1, fade = 1;
        const D0 = D;
        if (T > TL.fly0) {
            const k = easeInOut(clamp((T - TL.fly0) / (TL.fly1 - TL.fly0)));
            const box = hero.getBoundingClientRect();
            // fly to the globe card if it's on screen; on Home it's hidden, so just fade out
            if (box.width > 0) {
                gx = lerp(gx, box.left + box.width / 2, k); gy = lerp(gy, box.top + box.height / 2, k); D = lerp(D, box.width, k);
            } else {
                fade = 1 - k;
            }
            rest = 1 - k;
            document.body.classList.add("reveal");
        }
        const Rs = D * K * view.zoom;                    // radius of the planet on screen now
        const R1 = D0 * K;                               // radius of the planet before the zoom (the orbits use this)
        const scale = clamp(Math.min(W, H) / 760, 0.72, 1.25);

        fx.setTransform(intro.dpr, 0, 0, intro.dpr, 0, 0);
        fx.clearRect(0, 0, W, H);

        // ---- the sky ----
        fx.globalAlpha = rest * clamp((now - intro.t0) / 900);
        fx.drawImage(intro.sky, 0, 0, W, H);
        fx.fillStyle = "#fff";
        intro.twinkle.forEach(s => {
            const shine = 0.25 + 0.75 * Math.abs(Math.sin(now / 1000 * s.sp + s.ph));   // goes bright and dim
            fx.globalAlpha = rest * shine;
            fx.beginPath(); fx.arc(s.x, s.y, s.r, 0, TAU); fx.fill();
            if (s.big && shine > 0.7) {                     // big stars sparkle: a small cross of light
                const len = s.r * 7 * (shine - 0.7) / 0.3;
                fx.fillRect(s.x - len, s.y - 0.5, len * 2, 1);
                fx.fillRect(s.x - 0.5, s.y - len, 1, len * 2);
            }
        });
        fx.globalAlpha = 1;
        if (intro.hold) { return; }                      // still loading NASA's picture of the Earth

        // ---- the ground shakes after the impact ----
        const shake = T > TL.impact ? 18 * Math.exp(-(T - TL.impact) * 5) : 0;
        if (shake > 0.3 && !calm) { fx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); }

        // ---- the clues: where each one is right now ----
        const kp = project(KSA.lat, KSA.lon);
        const kx = gx + kp.x * Rs, ky = gy - kp.y * Rs;                 // Saudi Arabia on screen
        const fit = Math.min(1, W * 0.47 / (R1 * ORBIT.r[2]));          // squeeze the orbits on narrow screens
        const orbs = [];
        if (T > TL.orbit) {
            CLUES.forEach((clue, i) => {
                const ring = i % 3, radius = R1 * ORBIT.r[ring] * fit;
                const q = orbitPoint(radius, Math.floor(i / 3) * TAU / 4 + ring * 0.9 + ORBIT.speed[ring] * (T - TL.orbit), ring);   // spread evenly round each ring
                const out = easeOut(clamp((T - TL.orbit - i * 0.09) / 1.3));          // flying out of the impact
                const back = easeIn(clamp((T - TL.converge - i * 0.06) / 1.1));       // falling back into Saudi Arabia
                orbs.push({ c: clue,
                    x: lerp(lerp(kx, W / 2 + q.x, out), kx, back), y: lerp(lerp(ky, H * 0.56 + q.y, out), ky, back),
                    z: lerp(lerp(1, q.z / radius, out), 1, back),
                    a: out * (1 - back * back) * rest, s: lerp(0.3, 1, out) * (1 - 0.6 * back), label: clamp(out * 2 - 1) * (1 - clamp(back * 3)) });
            });
        }
        const rings = 0.2 * easeOut(clamp((T - TL.orbit - 0.4) / 1.2)) * (1 - clamp((T - TL.converge) / 0.8)) * rest;

        // ---- Terra: shows from the start, gone before the zoom ----
        const terra = terraPoint(T, R1 * 1.22 * fit, W / 2, H * 0.56);
        const terraAlpha = clamp((T - 0.2) / 0.8) * (1 - clamp((T - TL.converge) / 0.6)) * rest;

        // ---- behind the planet ----
        if (rings > 0.005) { for (let r = 0; r < 3; r++) { drawOrbitHalf(W / 2, H * 0.56, R1 * ORBIT.r[r] * fit, r, false, rings); } }
        orbs.filter(o => o.z < 0).forEach(o => drawOrb(o, gx, scale));
        if (terra.z < 0) { drawTerra(terra, scale, terraAlpha * 0.55, false); }      // behind: dimmer, and the planet will cover it

        // ---- the planet ----
        fx.globalAlpha = clamp((T - 0.15) / 1.1) * fade;           // fades in at the start; fades out at the end if it has nowhere to fly
        drawGlobe(fx, gx, gy, D, { ring: clamp((view.zoom - 1) / 0.6) * fade, hot: clamp((T - TL.zoom1 + 0.5) / 0.8) * fade, now: now, sweep: false });   // the ring and hotspots set their own see-through level, so they fade too
        fx.globalAlpha = 1;

        // ---- the impact, drawn on the planet ----
        if (T > TL.impact) {
            const since = T - TL.impact;
            fx.save(); fx.beginPath(); fx.arc(gx, gy, Math.min(Rs, D * LENS), 0, TAU); fx.clip();
            fx.globalCompositeOperation = "lighter";
            if (since < 2.6) {                                           // heat spreading from the hit
                const k = since / 2.6;
                const heat = fx.createRadialGradient(kx, ky, 0, kx, ky, Rs * (0.22 + 0.95 * k));
                heat.addColorStop(0, `rgba(255,214,150,${0.95 * (1 - k)})`); heat.addColorStop(0.3, `rgba(255,120,40,${0.6 * (1 - k)})`); heat.addColorStop(1, "rgba(255,80,20,0)");
                fx.fillStyle = heat; fx.fillRect(gx - Rs, gy - Rs, Rs * 2, Rs * 2);
            }
            for (let w = 0; w < 3; w++) {                                // three shock waves crossing the surface
                const k = (since - w * 0.28) / 1.9;
                if (k > 0 && k < 1) { shockRing(kp, easeOut(k) * 75 * RAD, gx, gy, Rs, `rgba(255,${200 - w * 30},${140 - w * 30},${(1 - k) * 0.9})`, (3.5 - w) * scale); }
            }
            fx.restore();
            // the glowing wound that stays on Saudi Arabia
            const ember = (0.55 + 0.45 * Math.sin(now / 160)) * clamp(since * 4) * (1 - clamp((T - TL.zoom0) / 1.2)) * rest;
            if (ember > 0.01) {
                const e = fx.createRadialGradient(kx, ky, 0, kx, ky, 26 * scale);
                e.addColorStop(0, `rgba(255,244,210,${ember})`); e.addColorStop(0.3, `rgba(255,170,70,${ember * 0.7})`); e.addColorStop(1, "rgba(255,120,40,0)");
                fx.globalCompositeOperation = "lighter"; fx.fillStyle = e;
                fx.beginPath(); fx.arc(kx, ky, 26 * scale, 0, TAU); fx.fill();
                fx.globalCompositeOperation = "source-over";
            }
        }

        // ---- in front of the planet ----
        if (rings > 0.005) { for (let r = 0; r < 3; r++) { drawOrbitHalf(W / 2, H * 0.56, R1 * ORBIT.r[r] * fit, r, true, rings); } }
        orbs.filter(o => o.z >= 0).forEach(o => drawOrb(o, gx, scale));
        if (terra.z >= 0) { drawTerra(terra, scale, terraAlpha, true); }             // in front: full colour, with its name

        // ---- the shooting star ----
        if (T > TL.meteor && T < TL.impact) {
            const u = (T - TL.meteor) / (TL.impact - TL.meteor);
            const s = Math.pow(u, 1.55);                                 // it speeds up as it falls
            const head = path(s), before = path(Math.max(0, s - 0.01));
            const dir = Math.atan2(head.y - before.y, head.x - before.x);
            const near = clamp((1.5 - Math.hypot(head.x - gx, head.y - gy) / Rs) / 0.5);   // 1 = inside the atmosphere, burning
            const bright = clamp(u * 3) * (0.9 + 0.1 * Math.sin(now / 23));

            fx.globalCompositeOperation = "lighter"; fx.lineCap = "round";
            const N = 46, gap = 0.004 + 0.011 * u;
            for (let pass = 0; pass < 2; pass++) {                       // a wide soft tail, then a thin bright one
                for (let j = N - 1; j >= 0; j--) {
                    const s1 = s - j * gap, s2 = s - (j + 1) * gap;
                    if (s2 < 0) { continue; }
                    const p1 = path(s1), p2 = path(s2), k = j / N;
                    const red = 255, green = Math.round(lerp(244, 70, Math.pow(k, 0.6))), blue = Math.round(lerp(214, 40, Math.pow(k, 0.4)));
                    fx.strokeStyle = `rgba(${red},${green},${blue},${Math.pow(1 - k, 2) * bright * (pass == 0 ? 0.16 : 0.9)})`;
                    fx.lineWidth = (Math.pow(1 - k, 1.5) * (5 + 4 * near) + 0.6) * scale * (pass == 0 ? 3.4 : 1);
                    fx.beginPath(); fx.moveTo(p2.x, p2.y); fx.lineTo(p1.x, p1.y); fx.stroke();
                }
            }
            const hr = (16 + 22 * near) * scale * bright;                // the glowing head
            const hg = fx.createRadialGradient(head.x, head.y, 0, head.x, head.y, hr * 2.2);
            hg.addColorStop(0, "rgba(255,255,255,1)"); hg.addColorStop(0.12, `rgba(${Math.round(lerp(200, 255, near))},235,${Math.round(lerp(255, 200, near))},0.9)`);
            hg.addColorStop(0.4, `rgba(${Math.round(lerp(120, 255, near))},${Math.round(lerp(180, 150, near))},${Math.round(lerp(255, 80, near))},0.28)`); hg.addColorStop(1, "rgba(0,0,0,0)");
            fx.fillStyle = hg; fx.beginPath(); fx.arc(head.x, head.y, hr * 2.2, 0, TAU); fx.fill();
            fx.save(); fx.translate(head.x, head.y); fx.rotate(dir);     // two thin flares crossing the head
            fx.fillStyle = `rgba(255,255,255,${0.5 * bright})`;
            fx.fillRect(-hr * 2.6, -0.6, hr * 5.2, 1.2); fx.fillRect(-0.6, -hr * 1.5, 1.2, hr * 3);
            fx.restore();
            fx.globalCompositeOperation = "source-over";

            // sparks break off the head
            for (let i = 0; i < 2 + u * 5; i++) {
                const back = dir + Math.PI + (Math.random() - 0.5) * 0.9, v = (60 + Math.random() * 240) * scale;
                intro.sparks.push({ x: head.x, y: head.y, vx: Math.cos(back) * v, vy: Math.sin(back) * v, life: 1, fade: 1.3 + Math.random() * 2, size: Math.random() * 1.6 + 0.6 });
            }
        }

        // ---- the moment of impact: a burst of glowing rock ----
        if (T >= TL.impact && !intro.boom) {
            intro.boom = true;
            const away = Math.atan2(intro.P1.y - H * 0.56, intro.P1.x - W / 2);
            for (let i = 0; i < 130; i++) {
                const a = away + (Math.random() - 0.5) * 2.6, v = (90 + Math.random() * 560) * scale;
                intro.debris.push({ x: intro.P1.x, y: intro.P1.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, fade: 0.55 + Math.random() * 1.1, size: Math.random() * 2.4 + 0.8 });
            }
        }
        fx.globalCompositeOperation = "lighter";
        [intro.sparks, intro.debris].forEach(list => {
            for (let i = list.length - 1; i >= 0; i--) {
                const p = list[i];
                p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.975; p.vy = p.vy * 0.975 + 30 * dt; p.life -= p.fade * dt;
                if (p.life <= 0) { list.splice(i, 1); continue; }
                fx.fillStyle = `rgba(255,${Math.round(90 + 150 * p.life)},${Math.round(40 + 120 * p.life * p.life)},${p.life})`;
                fx.beginPath(); fx.arc(p.x, p.y, p.size * scale * (0.5 + p.life * 0.5), 0, TAU); fx.fill();
            }
        });
        fx.globalCompositeOperation = "source-over";

        // ---- the flash ----
        if (T > TL.impact && T < TL.impact + 1.2) {
            const since = T - TL.impact;
            const bloom = fx.createRadialGradient(intro.P1.x, intro.P1.y, 0, intro.P1.x, intro.P1.y, R1 * (0.5 + since * 2.4));
            bloom.addColorStop(0, `rgba(255,255,255,${Math.exp(-since * 4)})`); bloom.addColorStop(0.3, `rgba(255,210,150,${0.7 * Math.exp(-since * 4)})`); bloom.addColorStop(1, "rgba(255,150,60,0)");
            fx.globalCompositeOperation = "lighter"; fx.fillStyle = bloom; fx.fillRect(-20, -20, W + 40, H + 40);
            fx.globalCompositeOperation = "source-over";
            fx.fillStyle = `rgba(255,250,240,${0.85 * Math.exp(-since * 7)})`; fx.fillRect(-20, -20, W + 40, H + 40);
        }

        // ---- the words ----
        $("introTitle").classList.toggle("show", T > TL.title && T < TL.fly0 - 0.5);
        setCaption(T);
    }

    // Starts (or replays) the intro film from the beginning
    function playIntro() {
        scrollTo(0, 0);
        document.body.classList.add("intro-on"); document.body.classList.remove("reveal");
        $("intro").style.display = "";
        $("introTitle").classList.remove("show"); $("caption").classList.remove("show");
        Object.assign(intro, { on: true, T: 0, last: performance.now(), t0: performance.now(), sparks: [], debris: [], boom: false, cap: -1 });
        sizeIntro();
    }

    let started = false;       // has the backend been asked for the first results yet?
    let firstDetect = null;
    // Ends the film: hides it, shows the Home page and points the globe at Saudi Arabia
    function endIntro() {
        intro.on = false;
        $("intro").style.display = "none";
        document.body.classList.remove("intro-on", "reveal");
        showTab("home");                                 // the intro ends on the Home page
        Object.assign(view, HOME);
        setGlobe({ lon0: HOME.lon0, lat0: HOME.lat0, zoom: HOME.zoom, hl: 1 }, performance.now());
        sizeHero();
        if (!started) {                                  // first time: once City A and B are done, scan the whole Kingdom
            started = true;
            Promise.resolve(firstDetect).then(() => scanAll());
        }
    }

    // --- the dashboard ---
    const view = Object.assign({}, HOME);    // where the dashboard globe is looking
    let fly = null;                          // a smooth move from one view to another
    let drag = null;                         // set while the globe is being dragged
    let heroSeen = true;                     // is the globe on screen?
    let mode = "";                           // "detect" or "scan" while the backend is working
    let pickSlot = "cityA";                  // which city a click on a hotspot changes

    // Makes the globe canvas sharp: as many pixels as it shows on screen (x2 on high-resolution screens)
    function sizeHero() {
        const size = Math.round(hero.clientWidth * Math.min(devicePixelRatio || 1, 2));
        if (size > 0 && hero.width != size) { hero.width = hero.height = size; }
    }

    // Starts a smooth move of the globe to a new view over ms milliseconds
    function flyTo(target, ms) {
        fly = { t0: performance.now(), ms: ms, from: Object.assign({}, view), to: Object.assign({}, view, target) };
    }

    // Draws one frame of the dashboard globe
    function heroFrame(now) {
        if (fly) {
            const k = clamp((now - fly.t0) / fly.ms), e = easeInOut(k);
            view.lon0 = lerp(fly.from.lon0, fly.to.lon0, e); view.lat0 = lerp(fly.from.lat0, fly.to.lat0, e); view.zoom = lerp(fly.from.zoom, fly.to.zoom, e);
            if (k >= 1) { fly = null; }
        }
        const sway = calm || drag ? 0 : Math.sin(now / 4200) * 1.3 * RAD;      // a slow, gentle drift
        const focus = lerp(0.3, 1, clamp((view.zoom - 1) / 1.4));         // zoomed out: the rest of the world keeps its colours
        setGlobe({ lon0: view.lon0 + sway, lat0: view.lat0, zoom: view.zoom, hl: focus }, now);
        updateGlobe(now);
        if (!tex || hero.width == 0) { return; }
        hx.clearRect(0, 0, hero.width, hero.height);
        drawGlobe(hx, hero.width / 2, hero.height / 2, hero.width, { ring: 1, hot: 1, border: 1, now: now, sweep: mode == "scan" });
    }

    // The one loop that draws everything, about 60 times a second
    function frame(now) {
        requestAnimationFrame(frame);
        if (intro.on) { introFrame(now); }
        else if (!document.hidden && heroSeen) { heroFrame(now); }
    }

    // ---------- Using the globe with the mouse or a finger ----------
    // Which hotspot (if any) is under the mouse or finger
    function spotAt(event) {
        const box = hero.getBoundingClientRect(), k = hero.width / box.width;
        const x = (event.clientX - box.left) * k, y = (event.clientY - box.top) * k;
        let best = null, bestGap = 16 * k;
        spots.forEach(s => {
            const gap = Math.hypot(s.sx - x, s.sy - y);
            if (s.vis && gap < bestGap) { best = s; bestGap = gap; }
        });
        return best;
    }

    // Shows the small box with a city's result next to its hotspot (or hides it when s is null)
    function showTip(s) {
        const tip = $("tip");
        if (!s) { tip.style.display = "none"; return; }
        let line = "Not tested yet";
        if (s.r) {
            line = `${s.r.slope > 0 ? "+" : ""}${(s.r.slope * 10).toFixed(3)} ${choice.unit} every 10 years`;      // "choice" comes from the backend
            line += s.r.real ? ` &middot; real ${s.r.direction.toLowerCase()} trend` : " &middot; no real trend";
        }
        tip.innerHTML = `<b>${s.name}</b>${line}`;
        const k = hero.clientWidth / hero.width;
        tip.style.left = s.sx * k + "px"; tip.style.top = s.sy * k + "px"; tip.style.display = "block";
    }

    hero.addEventListener("pointerdown", event => {
        hero.setPointerCapture(event.pointerId);
        fly = null;
        drag = { x: event.clientX, y: event.clientY, lon0: view.lon0, lat0: view.lat0, moved: 0 };
    });
    hero.addEventListener("pointermove", event => {
        if (drag) {
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            const radius = hero.clientWidth * K * view.zoom;
            drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
            view.lon0 = drag.lon0 - dx / radius;
            view.lat0 = clamp(drag.lat0 + dy / radius, -80 * RAD, 80 * RAD);
            if (drag.moved > 4) { hover = null; showTip(null); }
            return;
        }
        hover = spotAt(event);
        hero.style.cursor = hover ? "pointer" : "";
        showTip(hover);
    });
    hero.addEventListener("pointerup", event => {
        const wasClick = drag && drag.moved < 5;
        drag = null;
        const s = wasClick ? spotAt(event) : null;
        if (s) {                                         // a click on a hotspot: investigate that city
            $(pickSlot).value = s.value;
            showTab("compare");
            detect();
        }
    });
    hero.addEventListener("pointercancel", () => { drag = null; });
    hero.addEventListener("pointerleave", () => { hover = null; showTip(null); });

    $("zin").onclick = () => flyTo({ zoom: Math.min(9, view.zoom * 1.6) }, 380);
    $("zout").onclick = () => flyTo({ zoom: Math.max(1, view.zoom / 1.6) }, 380);
    $("zhome").onclick = () => flyTo(HOME, 900);
    $("pickA").onclick = () => { pickSlot = "cityA"; $("pickA").classList.add("on"); $("pickB").classList.remove("on"); };
    $("pickB").onclick = () => { pickSlot = "cityB"; $("pickB").classList.add("on"); $("pickA").classList.remove("on"); };

    // ---------- Tabs ----------
    let spaceLoaded = false;
    // Opens one tab: marks its button, shows its section, hides the globe on Home and About
    function showTab(name) {
        document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab == name));
        const btn = document.querySelector('.tabs button[data-tab="' + name + '"]');
        $("crumb").textContent = btn ? btn.textContent.trim() : name;
        document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.id == "tab-" + name));
        const solo = name == "home" || name == "about" || name == "myarea";   // no globe on these pages
        $("layout").classList.toggle("solo", solo);
        if (!solo) { sizeHero(); }
        Object.keys(charts).forEach(id => charts[id].resize());      // "charts" comes from the backend
        if (name == "space" && !spaceLoaded) { spaceLoaded = true; getData(); }
        scrollTo({ top: 0 });
    }
    document.querySelectorAll("[data-go]").forEach(el => {
        el.addEventListener("click", e => { e.preventDefault(); showTab(el.dataset.go); });
    });
    $("brand").onclick = () => showTab("home");
    $("brand").onkeydown = e => { if (e.key == "Enter" || e.key == " ") { e.preventDefault(); showTab("home"); } };
    document.querySelectorAll(".tabs button").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });

    $("swap").onclick = () => {
        const a = $("cityA").value;
        $("cityA").value = $("cityB").value; $("cityB").value = a;
        detect();
    };
    $("skip").onclick = endIntro;
    $("replay").onclick = playIntro;

    // ---------- The Trends tab: one button for each variable ----------
    function buildVars() {
        $("vars").innerHTML = Array.from($("variable").options).map(option => {
            const parts = option.value.split(",");
            const clue = CLUES.find(c => c.code == parts[0]);
            return `<button class="run" data-value="${option.value}">${icon(clue ? clue.icon : "temp")}${option.text}<small>${parts[1]}</small></button>`;
        }).join("");
        $("vars").querySelectorAll("button").forEach(b => {
            b.onclick = () => { $("variable").value = b.dataset.value; syncVars(); scanAll(); };
        });
        syncVars();
    }
    // Highlights the variable button that matches the "What to measure" box
    function syncVars() {
        $("vars").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.value == $("variable").value));
    }
    $("variable").addEventListener("change", syncVars);

    // ---------- The Causes tab: one card for each clue ----------
    function buildClues() {
        $("clues").innerHTML = CLUES.map(c => `
            <article class="clue">
                <header><span class="ico" style="color:${c.color}">${icon(c.icon, 24)}</span><h3>${c.name}<small>${c.suspect}</small></h3></header>
                <dl>
                    <div><dt class="m">What it measures</dt><dd>${c.measures}</dd></div>
                    <div><dt class="c">Why it can change</dt><dd>${c.cause}</dd></div>
                    <div><dt class="s">What can help</dt><dd>${c.fix}</dd></div>
                </dl>
                <div class="last" id="last-${c.code}"></div>
                <button class="ghost run" data-code="${c.code}">${c.space ? "See it from space" : "Test this trend"} &rarr;</button>
            </article>`).join("");
        $("clues").querySelectorAll("button").forEach(b => {
            b.onclick = () => {
                const clue = CLUES.find(c => c.code == b.dataset.code);
                if (clue.space) { showTab("space"); return; }
                const option = Array.from($("variable").options).find(o => o.value.split(",")[0] == clue.code);
                $("variable").value = option.value; syncVars();
                showTab("trends"); scanAll();
            };
        });
    }

    // --- hooks ---
    // We wrap part 1's functions: run the real one, then update the globe and cards.
    const backend = { investigate: investigate, detect: detect, scanAll: scanAll, draw: draw, getData: getData };
    let scanned = [];        // the results of the scan that is running

    // While the backend is busy, the buttons that start it are switched off
    function lock(on) {
        document.querySelectorAll("#btnDetect, #btnScan, #swap, .run").forEach(b => { b.disabled = on; });
    }

    // Writes the coloured top part of an answer card
    function showHead(slot, r) {
        let chip = `<span class="chip none">&#9679; NO CLEAR TREND</span>`;
        if (r.real && r.S > 0) { chip = `<span class="chip rising">&#9650; RISING &middot; REAL TREND</span>`; }
        if (r.real && r.S < 0) { chip = `<span class="chip falling">&#9660; FALLING &middot; REAL TREND</span>`; }
        const change = r.slope * 10, size = Math.abs(change);
        const text = (change > 0 ? "+" : change < 0 ? "−" : "") + size.toFixed(size >= 10 ? 1 : size >= 0.1 ? 2 : size >= 0.01 ? 3 : 4);
        const strength = clamp(-Math.log10(Math.max(r.p, 1e-12)) / 4) * 100;       // how far past the 5% line
        $("head" + slot).innerHTML = `
            <div class="top"><h3>${r.city}</h3>${chip}</div>
            <div class="big">${text} <small>${choice.unit} every 10 years</small></div>
            <div class="meter ${r.real ? "real" : ""}"><b style="width:${strength.toFixed(1)}%"></b><u></u></div>
            <div class="meter-words"><span>noise</span><span>&#8593; 5% line</span><span>strong evidence</span></div>`;
    }

    // Counts the scanned cities into rising / falling / no trend and updates the three boxes
    function showCounts() {
        let up = 0, down = 0, flat = 0;
        scanned.forEach(r => { if (r.real && r.S > 0) { up++; } else if (r.real) { down++; } else { flat++; } });
        $("nUp").textContent = up; $("nDown").textContent = down; $("nFlat").textContent = flat;
        $("progress").value = scanned.length;
        return { up: up, down: down, flat: flat };
    }

    // Colours the rows of the table that the backend wrote
    function tagRows() {
        Array.from($("table").rows).forEach(row => {
            if (row.cells.length < 6 || row.cells[0].tagName == "TH") { return; }
            const real = row.cells[5].textContent == "YES", direction = row.cells[2].textContent;
            row.className = real ? "real " + (direction == "RISING" ? "up" : "down") : "noise";
        });
    }
    $("table").addEventListener("click", event => {
        const row = event.target.closest("tr");
        const s = row && spotByName[row.cells[0].textContent];
        if (s) { $("cityA").value = s.value; showTab("compare"); detect(); }
    });

    window.investigate = async function (option) {
        // New case? Then the old hotspot colours no longer apply.
        const key = [choice.source, choice.code, choice.months.join("-"), choice.firstYear, choice.lastYear].join("|");
        if (key != spotsKey) { spotsKey = key; spots.forEach(s => { s.r = null; }); }

        const spot = spotByName[option.text];
        if (spot) { spot.pending = true; }
        try {
            const r = await backend.investigate(option);
            if (spot) { spot.r = r; }
            if (mode == "detect") { showHead(option.parentElement.id == "cityB" ? "B" : "A", r); }
            if (mode == "scan") { scanned.push(r); showCounts(); tagRows(); }
            return r;
        } finally {
            if (spot) { spot.pending = false; }
        }
    };

    window.detect = async function () {
        if (busy) { return; }                            // "busy" comes from the backend
        mode = "detect"; $("headA").innerHTML = ""; $("headB").innerHTML = ""; lock(true);
        try { await backend.detect(); }
        finally { mode = ""; lock(false); }
    };

    window.scanAll = async function () {
        if (busy) { return; }
        mode = "scan"; scanned = []; showCounts(); lock(true);
        $("progress").max = spots.length; $("progress").hidden = false;
        try { await backend.scanAll(); }
        finally {
            mode = ""; lock(false); $("progress").hidden = true; tagRows();
            if (scanned.length == spots.length) {        // remember the verdict for the Causes tab
                const n = showCounts();
                const line = $("last-" + choice.code);
                if (line) { line.textContent = `Last scan (${choice.season}, ${choice.firstYear} to ${choice.lastYear}): ${n.up} cities rising, ${n.down} falling, ${n.flat} with no real trend.`; }
            }
        }
    };

    window.getData = async function () {
        $("place").textContent = picked("cityA").text;
        $("btnData").disabled = true;
        try { await backend.getData(); }
        finally { $("btnData").disabled = false; }
    };

    // Gives every chart the dark look and the page's colours, then lets the backend draw it
    window.draw = function (id, type, data, options) {
        if (!window.Chart) { return; }
        if (id == "trendChart") {
            data.datasets.forEach(d => {
                const color = d.borderColor == "red" ? COLOR.a : COLOR.b;
                d.borderColor = color; d.backgroundColor = color; d.borderWidth = 2;
                if (!d.borderDash) { d.pointRadius = 2.5; d.pointHoverRadius = 6; d.pointBorderColor = COLOR.panel; d.pointBorderWidth = 1; }
            });
            options = {
                maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
                scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: `${choice.what} (${choice.unit})` } } },
                plugins: { legend: { labels: { boxWidth: 30, boxHeight: 0, filter: item => !item.text.endsWith(" trend") } } }
            };
        }
        if (id == "mapChart") {
            const look = { "Real rising trend": [COLOR.up, "triangle", 0, 9], "Real falling trend": [COLOR.down, "triangle", 180, 9], "No real trend": [COLOR.flat, "circle", 0, 5] };
            data.datasets.forEach(d => {
                const l = look[d.label];
                Object.assign(d, { backgroundColor: l[0], pointStyle: l[1], pointRotation: l[2], pointRadius: l[3], pointHoverRadius: l[3] + 2, pointBorderColor: COLOR.panel, pointBorderWidth: 2 });
            });
            data.datasets.push({ label: "border", data: OUTLINE.map(p => ({ x: p[0], y: p[1] })), showLine: true, pointRadius: 0, pointHitRadius: 0,
                                 borderColor: "rgba(0,132,61,0.6)", borderWidth: 1.5, backgroundColor: "rgba(0,132,61,0.05)", fill: "shape" });
            options = {
                maintainAspectRatio: false,
                scales: { x: { min: 34, max: 56, grid: { color: COLOR.grid }, ticks: { stepSize: 5, includeBounds: false, callback: v => v + "°E" } },
                          y: { min: 15.5, max: 33, grid: { color: COLOR.grid }, ticks: { stepSize: 2, includeBounds: false, callback: v => v + "°N" } } },
                plugins: {
                    legend: { labels: { usePointStyle: true, filter: item => item.text != "border" } },
                    tooltip: { filter: item => item.dataset.label != "border", callbacks: { label: item => {
                        const s = spots.find(spot => Math.abs(spot.lat / RAD - item.parsed.y) < 0.001 && Math.abs(spot.lon / RAD - item.parsed.x) < 0.001);
                        return " " + (s ? s.name + ": " : "") + item.dataset.label.toLowerCase();
                    } } }
                }
            };
        }
        if (id == "chart") {
            data.datasets.forEach(d => { Object.assign(d, { borderColor: COLOR.a, backgroundColor: "rgba(0,132,61,0.12)", fill: true, borderWidth: 2, pointRadius: 2.5 }); });
            options = { maintainAspectRatio: false, plugins: { legend: { display: false } },
                        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { title: { display: true, text: "NDVI" } } } };
        }
        if (id == "myChart") {         // "Is my area getting hotter?" chart: red line + dashed trend
            data.datasets.forEach(d => { Object.assign(d, { borderColor: COLOR.up, backgroundColor: COLOR.up, borderWidth: 2 }); });
            data.datasets[0].pointRadius = 2.5;
            options = { maintainAspectRatio: false,
                        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: "°C" } } },
                        plugins: { legend: { labels: { boxWidth: 30, boxHeight: 0 } } } };
        }
        backend.draw(id, type, data, options);
    };

    // --- start everything ---
    if (window.Chart) {
        Chart.defaults.color = "#3f5a49";
        Chart.defaults.borderColor = COLOR.grid;
        Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    }
    buildVars();
    buildClues();
    sizeHero();
    addEventListener("resize", () => { sizeHero(); if (intro.on) { sizeIntro(); } });
    if (window.IntersectionObserver) { new IntersectionObserver(list => { heroSeen = list[0].isIntersecting; }).observe(hero); }

    // The Earth: a drawn one right away, then NASA's Blue Marble photo as soon as it arrives
    buildTexture(paintFallback());
    const photo = new Image();
    photo.crossOrigin = "anonymous";
    photo.onload = () => { buildTexture(photo); intro.hold = false; };
    photo.onerror = () => { intro.hold = false; };
    photo.src = BLUE_MARBLE;
    setTimeout(() => { intro.hold = false; }, 4000);     // do not wait for the photo for more than 4 seconds

    // City A and City B are investigated while the intro plays, so the answers are ready when it ends
    firstDetect = detect();

    if (calm || location.search.includes("nointro")) { intro.hold = false; endIntro(); }
    else { playIntro(); }
    requestAnimationFrame(frame);
})();
