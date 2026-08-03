// Map Configuration
const MAP_CENTER = [30.3753, 69.3451]; // Center of Pakistan
const INITIAL_ZOOM = 6;
const MAX_BOUNDS = [
    [23.0, 60.0], // Southwest coordinates
    [37.5, 80.0]  // Northeast coordinates
];

// Initialize Map
const map = L.map('map', {
    center: MAP_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: 5,
    maxBounds: MAX_BOUNDS,
});

// Create custom panes for strict layering and clean pointer-events control
map.createPane('tehsilsPane');
map.createPane('districtsPane');
map.createPane('provincesPane');
map.createPane('riversPane');
map.createPane('roadsPane');

// Z-index hierarchy: Roads & Rivers on top, then Provinces, Districts, Tehsils
map.getPane('tehsilsPane').style.zIndex = 400;
map.getPane('districtsPane').style.zIndex = 401;
map.getPane('provincesPane').style.zIndex = 402;
map.getPane('riversPane').style.zIndex = 430;
map.getPane('roadsPane').style.zIndex = 440;
map.getPane('roadsPane').style.pointerEvents = 'none';

L.control.zoom({
    position: 'bottomright'
}).addTo(map);

// Basemaps definition
const darkTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
    crossOrigin: true
});

const satelliteTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 18,
    crossOrigin: true
});

// Pre-fetch districts and tehsils in background for instant 0ms switching
setTimeout(() => {
    loadMapData('districts');
    loadMapData('tehsils');
}, 500);

// State
function getActiveLayer() {
    if (document.getElementById('layer-tehsils').checked) return 'tehsils';
    if (document.getElementById('layer-districts').checked) return 'districts';
    if (document.getElementById('layer-provinces').checked) return 'provinces';
    return null;
}
let geojsonLayers = {
    provinces: null,
    districts: null,
    tehsils: null
};
let boundaryLayer = null;

let cachedData = {
    provinces: null,
    districts: null,
    tehsils: null
};

// UI Elements
const layerBtns = document.querySelectorAll('.layer-btn');
const regionDetails = document.getElementById('region-details');
const loadingOverlay = document.getElementById('loading');

// Style configurations
const provinceColors = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#f59e0b', // amber
    '#10b981', // emerald
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316'  // orange
];

function getFeatureColor(feature) {
    const props = feature.properties;
    const name = (props.adm1_name || props.NAME_1 || 'Unknown').toLowerCase().trim();
    
    // Explicit color mapping to ensure high contrast and prevent collisions
    if (name.includes('punjab')) return '#3b82f6';             // Blue
    if (name.includes('sindh')) return '#ef4444';              // Red
    if (name.includes('khyber') || name.includes('kpk')) return '#f97316'; // Bright Orange (contrasts with Violet AJK)
    if (name.includes('balochistan')) return '#10b981';        // Emerald
    if (name.includes('kashmir') || name.includes('ajk')) return '#8b5cf6'; // Violet
    if (name.includes('gilgit') || name.includes('baltistan')) return '#ec4899'; // Pink
    if (name.includes('islamabad') || name.includes('ict')) return '#06b6d4'; // Cyan
    
    return '#6b7280'; // Fallback Grey
}

function getFeatureStyle(feature) {
    const color = getFeatureColor(feature);
    const props = feature.properties;
    
    const isTehsil = props.shapeName || props.adm3_name || props.NAME_3;
    const isDistrict = !isTehsil && (props.adm2_name || props.NAME_2);
    const isProvince = !isTehsil && !isDistrict && (props.adm1_name || props.NAME_1);

    const active = getActiveLayer();

    if (active === 'tehsils') {
        if (isProvince) return { color: 'white', weight: 2.5, fill: false, opacity: 1 };
        if (isDistrict) return { color: 'white', weight: 1.0, fill: false, opacity: 0.6 };
        if (isTehsil) return { color: color, weight: 0.5, opacity: 0.5, fill: true, fillColor: color, fillOpacity: 0.2 };
    } else if (active === 'districts') {
        if (isProvince) return { color: 'white', weight: 2.5, fill: false, opacity: 1 };
        if (isDistrict) return { color: color, weight: 1.2, opacity: 0.8, fill: true, fillColor: color, fillOpacity: 0.2 };
    }
    
    return {
        color: color,
        weight: 1.5,
        opacity: 0.8,
        fill: true,
        fillColor: color,
        fillOpacity: 0.2
    };
}

function getHoverStyle(feature) {
    const color = getFeatureColor(feature);
    return {
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fill: true,
        fillColor: color,
        fillOpacity: 0.5
    };
}

// Helper: Extract name from feature properties based on available keys
function getRegionName(feature) {
    const props = feature.properties;
    // geoBoundaries
    if (props.shapeName) return `${props.shapeName} (Tehsil)`;
    
    // HDX naming format
    if (props.adm3_name) return `${props.adm3_name} (Tehsil)`;
    if (props.adm2_name) return `${props.adm2_name} (District)`;
    if (props.adm1_name) return `${props.adm1_name} (Province)`;
    
    // Fallbacks
    if (props.NAME_3) return `${props.NAME_3} (Tehsil)`;
    if (props.NAME_2) return `${props.NAME_2} (District)`;
    if (props.NAME_1) return `${props.NAME_1} (Province)`;
    
    // Capitals
    if (props.name) return `${props.name} (Capital)`;

    if (props.NAME_0) return props.NAME_0;
    return 'Unknown Region';
}

function getRegionParent(feature) {
    const props = feature.properties;
    let parents = [];
    const active = getActiveLayer();
    
    // HDX format
    if (props.adm1_name) parents.push(props.adm1_name);
    if (props.adm2_name && (active === 'tehsils' || props.name)) parents.push(props.adm2_name);
    
    // Fallback format
    if (!props.adm1_name && props.NAME_1) parents.push(props.NAME_1);
    if (!props.adm2_name && props.NAME_2 && active === 'tehsils') parents.push(props.NAME_2);
    
    return parents.length > 0 ? parents.join(', ') : '';
}

// Interaction Handlers
function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle(getHoverStyle(layer.feature));
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }
    
    // Update Info Panel (Keep clean & compact)
    const name = getRegionName(layer.feature);
    const parent = getRegionParent(layer.feature);

    regionDetails.innerHTML = `
        <div class="region-name">${name}</div>
        ${parent ? `<div><small style="color:var(--text-muted)">in ${parent}</small></div>` : ''}
    `;
}

function resetHighlight(e) {
    const layer = e.target;
    const active = getActiveLayer();
    if (active && geojsonLayers[active]) geojsonLayers[active].resetStyle(layer);
    regionDetails.innerHTML = 'Hover over a region to see details.';
}

function zoomToFeature(e) {
    const layer = e.target;
    map.flyToBounds(layer.getBounds(), {
        padding: [50, 50],
        duration: 0.8
    });
}

function createTooltipContent(feature) {
    const name = getRegionName(feature);
    const props = feature.properties;
    const showPop = document.getElementById('toggle-population') && document.getElementById('toggle-population').checked;
    
    if (props.pop_2023 && showPop) {
        return `
            <div style="font-weight: 700; font-size: 1rem; color: var(--accent);">${name}</div>
            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.15); font-size: 0.85rem;">
                <div>📊 <strong>${props.pop_2023.toLocaleString()}</strong> <span style="font-size: 0.75rem; color: var(--text-muted);">people</span></div>
                <div style="margin-top: 2px;">Density: <strong>${props.pop_density}</strong> / km²</div>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; font-style: italic; line-height: 1.2;">
                    Source: 7th Population Census 2023 (PBS)
                </div>
            </div>
        `;
    }
    return `<strong>${name}</strong>`;
}

function onEachFeature(feature, layer) {
    layer.bindTooltip(createTooltipContent(feature), {
        sticky: true,
        direction: 'auto',
        className: 'custom-tooltip'
    });
}

function updateInteractivity() {
    const active = getActiveLayer();
    ['provinces', 'districts', 'tehsils'].forEach(lyr => {
        if (!geojsonLayers[lyr]) return;
        geojsonLayers[lyr].setStyle(getFeatureStyle);
        
        geojsonLayers[lyr].eachLayer(layer => {
            const props = layer.feature.properties;
            const isTehsil = props.shapeName || props.adm3_name || props.NAME_3;
            const isDistrict = !isTehsil && (props.adm2_name || props.NAME_2);
            const isProvince = !isTehsil && !isDistrict;
            
            let isOverlay = false;
            if (active === 'tehsils' && (isProvince || isDistrict)) isOverlay = true;
            if (active === 'districts' && isProvince) isOverlay = true;
            
            if (isOverlay) {
                if (layer.getTooltip()) layer.unbindTooltip();
                layer.off('mouseover', highlightFeature);
                layer.off('mouseout', resetHighlight);
                layer.off('click', zoomToFeature);
            } else {
                layer.unbindTooltip();
                layer.bindTooltip(createTooltipContent(layer.feature), { sticky: true, direction: 'auto', className: 'custom-tooltip' });
                layer.off('mouseover', highlightFeature).on('mouseover', highlightFeature);
                layer.off('mouseout', resetHighlight).on('mouseout', resetHighlight);
                layer.off('click', zoomToFeature).on('click', zoomToFeature);
            }
        });
    });

    // Control pointer-events cleanly at the pane container level
    const provincesPane = map.getPane('provincesPane');
    const districtsPane = map.getPane('districtsPane');
    const tehsilsPane = map.getPane('tehsilsPane');

    if (provincesPane) {
        if (active === 'provinces') provincesPane.classList.remove('inactive-pane');
        else provincesPane.classList.add('inactive-pane');
    }
    if (districtsPane) {
        if (active === 'districts') districtsPane.classList.remove('inactive-pane');
        else districtsPane.classList.add('inactive-pane');
    }
    if (tehsilsPane) {
        if (active === 'tehsils') tehsilsPane.classList.remove('inactive-pane');
        else tehsilsPane.classList.add('inactive-pane');
    }
}

let searchMap = new Map();

function populateSearchList() {
    searchMap.clear();
    const datalist = document.getElementById('region-list');
    datalist.innerHTML = '';
    
    ['provinces', 'districts', 'tehsils'].forEach(layerName => {
        if (cachedData[layerName]) {
            cachedData[layerName].features.forEach(feature => {
                const name = getRegionName(feature);
                if (name && name !== 'Unknown Region') {
                    searchMap.set(name, { layerName, feature });
                }
            });
        }
    });

    const fragment = document.createDocumentFragment();
    const sortedNames = Array.from(searchMap.keys()).sort();
    sortedNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        fragment.appendChild(option);
    });
    datalist.appendChild(fragment);
}

// Data Loader
async function loadMapData(layerName) {
    if (geojsonLayers[layerName]) return;

    loadingOverlay.classList.remove('hidden');
    try {
        let url = `data/${layerName}.geojson`;
        if (!cachedData[layerName]) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            cachedData[layerName] = await response.json();
        }

        geojsonLayers[layerName] = L.geoJSON(cachedData[layerName], {
            style: getFeatureStyle,
            onEachFeature: onEachFeature,
            pane: layerName + 'Pane'
        });
        
        populateSearchList();
        
    } catch (error) {
        console.error('Error loading geojson:', error);
        regionDetails.innerHTML = `<span style="color:#ef4444">Error loading data for ${layerName}.</span>`;
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

// Update Layers
async function updateLayers() {
    const showTehsils = document.getElementById('layer-tehsils').checked;
    const showDistricts = document.getElementById('layer-districts').checked;
    const showProvinces = document.getElementById('layer-provinces').checked;

    if (showTehsils) await loadMapData('tehsils');
    if (showDistricts) await loadMapData('districts');
    if (showProvinces) await loadMapData('provinces');

    // Always ensure Pakistan boundary is loaded and shown
    if (!boundaryLayer) {
        try {
            const response = await fetch('data/pakistan_boundary.geojson');
            const data = await response.json();
            boundaryLayer = L.geoJSON(data, {
                style: {
                    color: '#10b981', // Pakistan Green/emerald
                    weight: 2.0,
                    fill: false,
                    opacity: 0.9,
                    interactive: false
                }
            });
        } catch (err) {
            console.error('Error loading Pakistan boundary:', err);
        }
    }

    ['provinces', 'districts', 'tehsils'].forEach(lyr => {
        if (geojsonLayers[lyr] && map.hasLayer(geojsonLayers[lyr])) {
            map.removeLayer(geojsonLayers[lyr]);
        }
    });

    if (showTehsils && geojsonLayers['tehsils']) map.addLayer(geojsonLayers['tehsils']);
    if (showDistricts && geojsonLayers['districts']) map.addLayer(geojsonLayers['districts']);
    if (showProvinces && geojsonLayers['provinces']) map.addLayer(geojsonLayers['provinces']);

    if (boundaryLayer && !map.hasLayer(boundaryLayer)) {
        map.addLayer(boundaryLayer);
    }
    if (boundaryLayer) {
        boundaryLayer.bringToFront();
    }

    // Update interactivity immediately and also defer slightly to ensure Leaflet's SVG DOM elements are ready
    updateInteractivity();
    setTimeout(updateInteractivity, 50);
}

// Overlays Logic
let capitalsLayer = null;
const toggleCapitals = document.getElementById('toggle-capitals');

toggleCapitals.addEventListener('change', async (e) => {
    if (e.target.checked) {
        // Load and show
        if (!capitalsLayer) {
            loadingOverlay.classList.remove('hidden');
            try {
                const response = await fetch('data/capitals.geojson');
                if (!response.ok) throw new Error('Error loading capitals');
                const data = await response.json();
                
                // Create custom icon
                const capitalIcon = L.divIcon({
                    html: '<div style="background-color: #ef4444; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
                    className: '',
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                });

                capitalsLayer = L.geoJSON(data, {
                    pointToLayer: function (feature, latlng) {
                        return L.marker(latlng, {icon: capitalIcon});
                    },
                    onEachFeature: (feature, layer) => {
                        const name = getRegionName(feature);
                        const parent = getRegionParent(feature);
                        layer.bindTooltip(name, {
                            sticky: true,
                            direction: 'auto',
                            className: 'custom-tooltip'
                        });
                        layer.on('mouseover', () => {
                            regionDetails.innerHTML = `
                                <div class="region-name">${name}</div>
                                ${parent ? '<div><small style="color:var(--text-muted)">in ' + parent + '</small></div>' : ''}
                            `;
                        });
                        layer.on('mouseout', () => {
                            regionDetails.innerHTML = 'Hover over a region to see details.';
                        });
                    }
                });
            } catch (err) {
                console.error(err);
                e.target.checked = false; // Revert
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        }
        if (capitalsLayer) map.addLayer(capitalsLayer);
    } else {
        // Hide
        if (capitalsLayer && map.hasLayer(capitalsLayer)) {
            map.removeLayer(capitalsLayer);
        }
    }
});

let riversLayer = null;
const toggleRivers = document.getElementById('toggle-rivers');

toggleRivers.addEventListener('change', async (e) => {
    if (e.target.checked) {
        if (!riversLayer) {
            loadingOverlay.classList.remove('hidden');
            try {
                const response = await fetch('data/rivers.geojson');
                if (!response.ok) throw new Error('Error loading rivers');
                const data = await response.json();
                
                riversLayer = L.geoJSON(data, {
                    pane: 'riversPane',
                    filter: function(feature) {
                        if (!feature.properties || !feature.properties.NAM) return false;
                        const name = feature.properties.NAM.toUpperCase();
                        if (name === 'UNK') return false;
                        const allowedRivers = ['INDUS', 'JHELUM', 'CHENAB', 'RAVI', 'SUTLEJ', 'KABUL', 'SWAT', 'SOAN', 'HINGOL'];
                        return allowedRivers.some(r => name.includes(r));
                    },
                    style: function (feature) {
                        const name = (feature.properties && feature.properties.NAM) ? feature.properties.NAM.toUpperCase() : '';
                        const isIndus = name.includes('INDUS');
                        return {
                            color: '#0284c7', // Vibrant Deep Blue
                            weight: isIndus ? 4.0 : 2.5,
                            opacity: 0.95
                        };
                    },
                    onEachFeature: (feature, layer) => {
                        if (feature.properties && feature.properties.NAM && feature.properties.NAM !== 'UNK') {
                            layer.bindTooltip(`🌊 ${feature.properties.NAM} River`, {
                                sticky: true,
                                direction: 'auto',
                                className: 'custom-tooltip'
                            });
                        }
                    }
                });
            } catch (err) {
                console.error(err);
                e.target.checked = false;
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        }
        if (riversLayer) map.addLayer(riversLayer);
    } else {
        if (riversLayer && map.hasLayer(riversLayer)) {
            map.removeLayer(riversLayer);
        }
    }
});

let roadsLayer = null;
const toggleRoads = document.getElementById('toggle-roads');
if (toggleRoads) {
    toggleRoads.addEventListener('change', (e) => {
        if (e.target.checked) {
            if (!roadsLayer) {
                roadsLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', {
                    maxZoom: 20,
                    pane: 'roadsPane',
                    opacity: 0.85,
                    crossOrigin: true
                });
            }
            map.addLayer(roadsLayer);
        } else {
            if (roadsLayer && map.hasLayer(roadsLayer)) {
                map.removeLayer(roadsLayer);
            }
        }
    });
}

// Search Feature
document.getElementById('region-search').addEventListener('change', (e) => {
    const val = e.target.value;
    const match = searchMap.get(val);
    if (match) {
        const checkbox = document.getElementById(`layer-${match.layerName}`);
        if (!checkbox.checked) {
            checkbox.checked = true;
            updateLayers().then(() => highlightAndZoomTo(match));
        } else {
            highlightAndZoomTo(match);
        }
    }
});

function highlightAndZoomTo(match) {
    const layerGrp = geojsonLayers[match.layerName];
    let targetLayer = null;
    layerGrp.eachLayer(l => {
        if (l.feature === match.feature) targetLayer = l;
    });
    
    if (targetLayer) {
        map.flyToBounds(targetLayer.getBounds(), { padding: [50, 50], duration: 1.5 });
        
        layerGrp.eachLayer(l => layerGrp.resetStyle(l));
        
        targetLayer.setStyle(getHoverStyle(targetLayer.feature));
        if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
            targetLayer.bringToFront();
        }
        
        const name = getRegionName(targetLayer.feature);
        const parent = getRegionParent(targetLayer.feature);
        regionDetails.innerHTML = `
            <div class="region-name">${name}</div>
            ${parent ? `<div><small style="color:var(--text-muted)">in ${parent}</small></div>` : ''}
        `;
    }
}

// Event Listeners for Checkboxes
document.getElementById('layer-provinces').addEventListener('change', updateLayers);
document.getElementById('layer-districts').addEventListener('change', updateLayers);
document.getElementById('layer-tehsils').addEventListener('change', updateLayers);

// Init
updateLayers();

// Clean SVG Exporter (returns standalone SVG with ONLY clean presentation attributes, cropped to map elements)
function getCleanSvgString() {
    const overlaySvg = document.querySelector('.leaflet-overlay-pane svg');
    if (!overlaySvg) return null;
    
    const svgClone = overlaySvg.cloneNode(true);
    
    // Find bounds of all active features
    let bounds = L.latLngBounds();
    let hasActive = false;
    
    if (boundaryLayer && map.hasLayer(boundaryLayer)) {
        bounds.extend(boundaryLayer.getBounds());
        hasActive = true;
    }
    ['provinces', 'districts', 'tehsils'].forEach(lyr => {
        if (geojsonLayers[lyr] && map.hasLayer(geojsonLayers[lyr])) {
            bounds.extend(geojsonLayers[lyr].getBounds());
            hasActive = true;
        }
    });
    if (riversLayer && map.hasLayer(riversLayer)) {
        bounds.extend(riversLayer.getBounds());
        hasActive = true;
    }
    
    if (!hasActive || !bounds.isValid()) {
        bounds = L.latLngBounds([[23.695, 60.872], [37.098, 77.837]]); // Pakistan bbox
    }
    
    // Convert geographic bounds to Leaflet layer points
    const nw = map.latLngToLayerPoint(bounds.getNorthWest());
    const se = map.latLngToLayerPoint(bounds.getSouthEast());
    
    const padding = 20;
    const x = nw.x - padding;
    const y = nw.y - padding;
    const w = (se.x - nw.x) + (padding * 2);
    const h = (se.y - nw.y) + (padding * 2);
    
    svgClone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    svgClone.setAttribute('width', w);
    svgClone.setAttribute('height', h);
    svgClone.removeAttribute('style');
    svgClone.removeAttribute('class');
    
    // Ensure all styles are PowerPoint compatible (no CSS variables, absolute presentation attributes)
    const paths = svgClone.querySelectorAll('path');
    paths.forEach(path => {
        path.removeAttribute('class');
        
        const computedStyle = window.getComputedStyle(path);
        
        let fill = path.getAttribute('fill') || path.style.fill || computedStyle.fill;
        let stroke = path.getAttribute('stroke') || path.style.stroke || computedStyle.stroke;
        let strokeWidth = path.getAttribute('stroke-width') || path.style.strokeWidth || computedStyle.strokeWidth;
        let fillOpacity = path.getAttribute('fill-opacity') || path.style.fillOpacity || computedStyle.fillOpacity;
        let strokeOpacity = path.getAttribute('stroke-opacity') || path.style.strokeOpacity || computedStyle.strokeOpacity;
        
        // Leaflet sets interactive path fills to translucent or none
        if (fill === 'none' || fill === '' || fill === 'rgba(0, 0, 0, 0)') {
            fill = 'none';
        }
        
        path.setAttribute('fill', fill);
        path.setAttribute('stroke', stroke);
        if (strokeWidth) {
            path.setAttribute('stroke-width', strokeWidth.replace('px', ''));
        }
        if (fillOpacity) path.setAttribute('fill-opacity', fillOpacity);
        if (strokeOpacity) path.setAttribute('stroke-opacity', strokeOpacity);
        
        path.removeAttribute('style');
    });
    
    const serializer = new XMLSerializer();
    return serializer.serializeToString(svgClone);
}

// Export Map Feature
document.getElementById('export-png').addEventListener('click', () => {
    loadingOverlay.classList.remove('hidden');
    setTimeout(() => {
        const svgString = getCleanSvgString();
        if (!svgString) {
            alert('No map elements found to export.');
            loadingOverlay.classList.add('hidden');
            return;
        }
        
        const img = new Image();
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const URL = window.URL || window.webkitURL || window;
        const blobURL = URL.createObjectURL(svgBlob);
        
        img.onload = function() {
            const canvas = document.createElement('canvas');
            // Export high-resolution PNG
            const targetWidth = 2000;
            const scale = targetWidth / img.width;
            canvas.width = targetWidth;
            canvas.height = img.height * scale;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            const pngUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = 'pakistan-map.png';
            link.href = pngUrl;
            link.click();
            
            URL.revokeObjectURL(blobURL);
            loadingOverlay.classList.add('hidden');
        };
        img.onerror = function(err) {
            console.error('Error drawing image for PNG download', err);
            alert('Could not export map to PNG.');
            loadingOverlay.classList.add('hidden');
        };
        img.src = blobURL;
    }, 100);
});

document.getElementById('export-svg').addEventListener('click', () => {
    loadingOverlay.classList.remove('hidden');
    setTimeout(() => {
        const svgString = getCleanSvgString();
        if (!svgString) {
            alert('No map elements found to export.');
            loadingOverlay.classList.add('hidden');
            return;
        }
        
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const URL = window.URL || window.webkitURL || window;
        const blobURL = URL.createObjectURL(svgBlob);
        
        const link = document.createElement('a');
        link.download = 'pakistan-map.svg';
        link.href = blobURL;
        link.click();
        
        setTimeout(() => URL.revokeObjectURL(blobURL), 100);
        loadingOverlay.classList.add('hidden');
    }, 100);
});

// Basemap Switcher Logic
document.getElementById('basemap-select').addEventListener('change', (e) => {
    const val = e.target.value;
    
    // Remove all basemaps
    if (map.hasLayer(darkTileLayer)) map.removeLayer(darkTileLayer);
    if (map.hasLayer(satelliteTileLayer)) map.removeLayer(satelliteTileLayer);
    
    // Add selected
    if (val === 'dark') {
        darkTileLayer.addTo(map);
        darkTileLayer.bringToBack();
    } else if (val === 'satellite') {
        satelliteTileLayer.addTo(map);
        satelliteTileLayer.bringToBack();
    }
});

// Toggle Population Listener
const togglePopulation = document.getElementById('toggle-population');
if (togglePopulation) {
    togglePopulation.addEventListener('change', (e) => {
        if (e.target.checked) {
            // Auto-check Provinces layer if not checked
            const provCb = document.getElementById('layer-provinces');
            if (provCb && !provCb.checked) {
                provCb.checked = true;
            }
        }
        updateLayers();
    });
}
