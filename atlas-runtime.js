const Land = (() => {
  const { Vector3, Quaternion, Matrix4, Color, BufferGeometry, Float32BufferAttribute } = THREE;
  const radius = 4.15;
  const waterLevel = -0.035;
  const tau = Math.PI * 2;
  const clamp = THREE.MathUtils.clamp;
  const mix = THREE.MathUtils.lerp;
  const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);
  const wrap = (angle) => THREE.MathUtils.euclideanModulo(angle + Math.PI, tau) - Math.PI;
  const direction = (lon, lat) => new Vector3(Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat));
  const river = (lon) => -.12 + .23 * Math.sin(lon - .4) + .13 * Math.sin(3 * lon + .65) + .045 * Math.sin(5 * lon + 1.7);
  const riverWidth = (lon) => .105 + .031 * Math.sin(lon * 4 - .2) + .022 * Math.sin(lon * 7 + 1);
  const pools = [
    { lon: .75, lat: -.37, x: .30, y: .215 },
    { lon: 2.29, lat: .53, x: .27, y: .19 },
    { lon: -2.34, lat: -.52, x: .29, y: .18 }
  ];
  const landmarks = {
    home: { lon: -.50, lat: .50 },
    bridge: { lon: .18, lat: river(.18) },
    pond: { lon: .75, lat: -.37 },
    grove: { lon: -.69, lat: -.55 },
    mill: { lon: 1.79, lat: .52 },
    camp: { lon: -2.12, lat: .32 }
  };
  const districts = {
    meadow: { lon: -.50, lat: .42 },
    shore: { lon: 2.62, lat: .35 },
    pond: { lon: .77, lat: -.39 }
  };

  function rng(seed) {
    return () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function surface(lon, lat) {
    const ground = Math.abs(lat - river(lon)) - riverWidth(lon);
    let margin = ground;
    for (const pool of pools) {
      const x = wrap(lon - pool.lon) / pool.x;
      const y = (lat - pool.lat) / pool.y;
      // The shoreline ripples move the edge by at most .17.
      if ((Math.max(Math.abs(x), Math.abs(y)) - 1.18) * pool.y > margin) continue;
      const angle = Math.atan2(y, x);
      const shape = Math.hypot(x, y) - 1 + .11 * Math.sin(angle * 3 + .35) + .06 * Math.cos(angle * 5);
      margin = Math.min(margin, shape * pool.y);
    }
    return margin;
  }

  function hills(normal) {
    const {x, y, z} = normal;
    return Math.sin(9 * x + 4 * y) * Math.cos(10 * z - 5 * y) * .052
      + Math.sin(x * 6 - z * 6 + 16 * y) * .027
      + Math.sin(19 * x + 17 * y - 14 * z) * .017
      + Math.cos(z * 4 - y * 3) * Math.sin(x * 5 + y * 7) * .075;
  }

  function terrainHeight(shore, relief) {
    return mix(-.14, .115 + relief, smooth(-.045, .089, shore)) + .026 * smooth(.08, .27, shore);
  }

  function point(lon, lat, offset = 0) {
    const normal = direction(lon, lat);
    return normal.multiplyScalar(radius + terrainHeight(surface(lon, lat), hills(normal)) + offset);
  }

  function frame(lon, lat, offset = 0) {
    const east = new Vector3(Math.cos(lon), 0, -Math.sin(lon));
    const up = direction(lon, lat);
    const south = east.clone().cross(up);
    return {
      position: point(lon, lat, offset),
      rotation: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(east, up, south))
    };
  }

  const trails = [
    [[-.51,.37],[-.40,.29],[-.17,.21],[.04,.23],[.13,.17],[.18,.06]],
    [[.18,-.24],[.06,-.33],[-.14,-.48],[-.38,-.53],[-.62,-.52],[-.79,-.59]],
    [[.18,-.24],[.34,-.32],[.42,-.44],[.56,-.56],[.78,-.62]]
  ];
  const segments = trails.flatMap(trail => trail.slice(1).map(([endLon, endLat], index) => {
    const [lon, lat] = trail[index];
    const dx = endLon - lon, dy = endLat - lat;
    return { lon, lat, dx, dy, lengthSquared: dx * dx + dy * dy };
  }));
  const trackEdge = .047;
  const trackRipple = .006;
  const trackMargin = trackEdge + trackRipple;
  const trailPoints = trails.flat();
  const trailLons = trailPoints.map(([lon]) => lon);
  const trailLats = trailPoints.map(([, lat]) => lat);
  const trailBounds = {
    west: Math.min(...trailLons) - trackMargin, east: Math.max(...trailLons) + trackMargin,
    south: Math.min(...trailLats) - trackMargin, north: Math.max(...trailLats) + trackMargin
  };

  function trailDist(lon, lat) {
    let nearestSquared = Infinity;
    for (const segment of segments) {
      const x = wrap(lon - segment.lon), y = lat - segment.lat;
      const t = clamp((x * segment.dx + y * segment.dy) / segment.lengthSquared, 0, 1);
      const across = x - segment.dx * t, along = y - segment.dy * t;
      nearestSquared = Math.min(nearestSquared, across * across + along * along);
    }
    return Math.sqrt(nearestSquared);
  }

  function globeGeometry(slices, bands, paint) {
    const positions = [], colors = [], uv = [], indices = [];
    for (let j = 0; j <= bands; j++) {
      const lat = (j / bands - .5) * Math.PI;
      for (let i = 0; i <= slices; i++) {
        const lon = (i / slices - .5) * tau;
        const {position, color} = paint(lon, lat);
        positions.push(position.x, position.y, position.z);
        colors.push(color.r, color.g, color.b);
        uv.push(i / slices, j / bands);
        if (i < slices && j < bands) {
          const a = j * (slices + 1) + i;
          indices.push(a, a + 1, a + slices + 1, a + 1, a + slices + 2, a + slices + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal');
    for (let j = 0; j <= bands; j++) {
      const first = j * (slices + 1);
      const last = first + slices;
      const shared = new Vector3().fromBufferAttribute(normals, first)
        .add(new Vector3().fromBufferAttribute(normals, last)).normalize();
      normals.setXYZ(first, shared.x, shared.y, shared.z);
      normals.setXYZ(last, shared.x, shared.y, shared.z);
      if (j === 0 || j === bands) {
        for (let i = 0; i <= slices; i++) normals.setXYZ(first + i, 0, j === 0 ? -1 : 1, 0);
      }
    }
    return geometry;
  }

  function create(world) {
    const palette = ['#739e48', '#b8cf64', '#9fbc5e', '#d6bd79', '#84b559'].map((c) => new Color(c));
    const terrain = globeGeometry(320, 160, (lon, lat) => {
      const normal = direction(lon, lat);
      const {x, y, z} = normal;
      const grass = .5 + .19 * Math.sin(x * 19 + y * 9 - z * 4) * Math.cos(z * 20 + y * 13)
        + .13 * Math.sin(x * 31 + y * 43 + z * 5) + .17 * Math.cos(x * 7 - y * 9 + z * 17);
      const shore = surface(lon, lat);
      const relief = hills(normal);
      const color = palette[0].clone().lerp(palette[1], clamp(grass, .04, .97));
      color.lerp(palette[2], smooth(.08, .25, relief + .08) * .63);
      color.lerp(palette[4], (1 - smooth(.015, .083, shore)) * .8);
      if (lon >= trailBounds.west && lon <= trailBounds.east && lat >= trailBounds.south && lat <= trailBounds.north) {
        const track = trailDist(lon, lat) + trackRipple * Math.sin(lon * 69) * Math.cos(lat * 67);
        color.lerp(palette[3], (1 - smooth(.019, trackEdge, track)) * smooth(.016, .081, shore) * .89);
      }
      return { position: normal.multiplyScalar(radius + terrainHeight(shore, relief)), color };
    });
    const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const expanded = { value: 0 };
    const districtUniforms = {
      uExpanded: expanded,
      uShore: { value: direction(districts.shore.lon, districts.shore.lat) },
      uPond: { value: direction(districts.pond.lon, districts.pond.lat) }
    };
    groundMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, districtUniforms);
      shader.vertexShader = 'varying vec3 vLand;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvLand = position;'
      );
      shader.fragmentShader = 'varying vec3 vLand; uniform float uExpanded; uniform vec3 uShore, uPond;\n'
        + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec3 radial = normalize(vLand);
          float shore = uExpanded * smoothstep(0.77, 0.95, dot(radial, uShore));
          float pond = uExpanded * smoothstep(0.93, 0.99, dot(radial, uPond));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.56,0.86,0.56) + vec3(.08,.008,.012), shore);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62,0.82,1.52), pond * .78);`);
    };
    const ground = new THREE.Mesh(terrain, groundMaterial);
    ground.receiveShadow = true;
    world.add(ground);

    const color = new Color('#269cc5');
    const waterGeometry = globeGeometry(250, 124, (lon, lat) => ({
      position: direction(lon, lat).multiplyScalar(radius + waterLevel),
      color
    }));
    const waterMaterial = new THREE.MeshStandardMaterial({ color, roughness: .83, emissive: '#193c53' });
    const time = { value: 0 };
    const night = { value: 0 };
    const moon = { value: new Vector3() };
    const origin = { value: new Vector3() };
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.uniforms.uNight = night;
      shader.uniforms.uMoon = moon;
      shader.uniforms.uOrigin = origin;
      Object.assign(shader.uniforms, districtUniforms);
      shader.vertexShader = 'varying vec3 vWater;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvWater = position;'
      );
      shader.fragmentShader = 'varying vec3 vWater; uniform float uTime, uNight, uExpanded; uniform vec3 uMoon, uOrigin, uShore, uPond;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float current = vWater.y * 21.0 - vWater.z * 11.0 + sin(vWater.x * 12.0) * 0.66;
        float crest = smoothstep(0.83, 0.99, sin(current - uTime * 0.85));
        float drifts = sin(vWater.x * 20.0 + vWater.z * 13.0 + sin(vWater.y * 11.0) + uTime * 0.45)
          + 0.69 * sin(vWater.x * 27.0 - vWater.y * 14.0 + vWater.z * 21.0 - uTime * 0.34);
        float ripple = crest * smoothstep(0.26, 1.25, drifts);
        diffuseColor.rgb *= 1.00 + 0.06 * sin(vWater.y * 8.0 + vWater.z * 9.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.030, 0.17, 0.23), uNight * 0.72);
        float coast = uExpanded * smoothstep(.84, .96, dot(normalize(vWater), uShore));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.38,.145,.38), coast*.79);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.29, 0.72, 0.75), ripple * mix(0.22, 0.08, uNight));`
      ).replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 reflected = normalize(normalize(uMoon - uOrigin) + normalize(cameraPosition - uOrigin - vWater));
        float glint = pow(max(dot(normalize(vWater), reflected), 0.0), 24.0);
        totalEmissiveRadiance += vec3(0.26, 0.51, 0.78) * uNight * (glint * (0.036 + 0.38 * ripple));`
      );
    };
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.receiveShadow = true;
    world.add(water);
    return { time, night, moon, origin, waterMaterial, expanded };
  }

  return { radius, waterLevel, tau, direction, point, frame, river, riverWidth, surface, trailDist, landmarks, districts, pools, rng, globeGeometry, create };
})();

;
const Scenery = (() => {
  const { Vector2, Vector3, Quaternion, Group, Mesh, Color } = THREE;
  const random = Land.rng(280593);
  const tau = Land.tau;
  const seedBetween = (min, max) => min + (max - min) * random();
  const pick = (items) => items[Math.floor(random() * items.length)];
  const up = new Vector3(0, 1, 0);
  const shapes = {
    pebble: new THREE.IcosahedronGeometry(1, 1),
    round: new THREE.SphereGeometry(1, 14, 11),
    tiny: new THREE.SphereGeometry(1, 7, 5),
    firCrown: new THREE.LatheGeometry([
      new Vector2(0,-.50),new Vector2(.64,-.48),new Vector2(1,-.38),
      new Vector2(.73,-.19),new Vector2(.37,.10),new Vector2(.05,.47),new Vector2(0,.50)
    ],8),
    box: new THREE.BoxGeometry(1, 1, 1),
    stem: new THREE.CylinderGeometry(.77, 1, 1, 8),
    ring: new THREE.TorusGeometry(1, .10, 8, 26)
  };
  const palette = ['#80ac4c', '#9bb95b', '#638f45', '#b3c85c', '#568147', '#739b54', '#a9c568'];
  const cypressColors = ['#287963', '#438b67', '#286b5d', '#569574', '#357e65'];
  const petalPalettes = ['#f493af', '#f6dd6e', '#91a7ee', '#fff0cd', '#f19672', '#c5a3eb'];
  const bark = '#7d5c40';
  const wood = ['#986842', '#aa784c', '#bd8a57', '#a16e46', '#a97a55'];
  const materials = new Map();
  const windowGlass = new THREE.MeshStandardMaterial({ color: '#ffdb82', roughness: .75, emissive: '#ffaa43', emissiveIntensity: 0 });
  const lanternGlass = new THREE.MeshStandardMaterial({ color: '#f5d99a', roughness: .65, emissive: '#ffaf5b', emissiveIntensity: 0 });
  const flameCore = new THREE.MeshStandardMaterial({ color: '#ffce68', roughness: .9, emissive: '#ff9b35', emissiveIntensity: 0 });

  function at(lon, lat, offset = 0, yaw = 0) {
    const group = new Group();
    const location = Land.frame(lon, lat, offset);
    group.position.copy(location.position);
    group.quaternion.copy(location.rotation);
    group.rotateY(yaw);
    return group;
  }

  function paletteMaterial(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .88 }));
    return materials.get(color);
  }

  function model(parent, geometry, color, position, scale, rotation) {
    const material = typeof color === 'string' ? paletteMaterial(color) : color;
    const mesh = new Mesh(shapes[geometry] || geometry, material);
    mesh.position.fromArray(position);
    mesh.scale.fromArray(scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function batchRepeatedParts(root, movingPart = null) {
    const batches = new Map();
    root.updateWorldMatrix(true, true);
    const local = root.matrixWorld.clone().invert();
    const transform = new THREE.Matrix4();

    function collect(parent) {
      for (const part of parent.children) {
        if (part === movingPart) continue;
        if (part.isMesh && !part.isInstancedMesh) {
          const key = `${part.geometry.id}/${part.material.id}/${part.castShadow}/${part.receiveShadow}`;
          if (!batches.has(key)) batches.set(key, []);
          batches.get(key).push(part);
        } else if (part.isGroup) {
          collect(part);
        }
      }
    }

    collect(root);
    for (const parts of batches.values()) {
      if (parts.length < 2) continue;
      const [first] = parts;
      const batch = new THREE.InstancedMesh(first.geometry, first.material, parts.length);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      for (const [i, part] of parts.entries()) {
        batch.setMatrixAt(i, transform.multiplyMatrices(local, part.matrixWorld));
        part.removeFromParent();
      }
      root.add(batch);
    }
  }

  function makeDecoration(world, frameAt = Land.frame) {
    const batches = new Map();
    const local = new THREE.Object3D();
    const root = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const flatMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .96 });

    function positionAt(lon, lat, offset = 0, yaw = 0, scale = 1) {
      const {position, rotation} = frameAt(lon, lat, offset);
      rotation.multiply(new Quaternion().setFromAxisAngle(up, yaw));
      root.compose(position, rotation, new Vector3(scale, scale, scale));
    }

    function add(kind, color, position, scale, rotation, shadow = true) {
      const key = kind + (shadow ? '-shadow' : '');
      if (!batches.has(key)) batches.set(key, { instances: [], kind, shadow });
      local.position.fromArray(position);
      local.scale.fromArray(scale);
      local.rotation.set(...(rotation || [0, 0, 0]));
      local.updateMatrix();
      batches.get(key).instances.push([matrix.multiplyMatrices(root, local.matrix).clone(), new Color(color)]);
    }

    function commit() {
      for (const {instances, kind, shadow} of batches.values()) {
        const batch = new THREE.InstancedMesh(shapes[kind], flatMaterial, instances.length);
        for (const [i, [transform, color]] of instances.entries()) {
          batch.setMatrixAt(i, transform);
          batch.setColorAt(i, color);
        }
        batch.castShadow = shadow;
        batch.receiveShadow = true;
        world.add(batch);
      }
    }

    return { positionAt, add, commit };
  }

  function garden(world) {
    const { positionAt, add, commit } = makeDecoration(world);
    const treeSites = [
      [-1.13,.77,1.03,0], [-.91,.76,.82,1], [-.77,.85,1.01,1], [.82,.79,1.14,0],
      [1.05,.59,.86,1], [.96,.45,.90,1], [1.17,.42,.63,1], [1.27,.68,.74,1],
      [-1.14,-.33,.99,0], [-1.30,-.43,.85,1], [-1.35,-.29,.62,1],
      [-.79,-.70,.88,0], [-.95,-.55,.81,1], [-.99,-.70,.70,1], [-.63,-.83,.64,1],
      [.19,-.91,.89,0], [.44,-.97,.60,1], [.69,-.77,.71,1],
      [.06,.98,.64,0], [.25,.84,.78,1], [.35,.95,.59,1], [-.06,.76,.54,1],
      [-.91,.13,.63,0], [1.04,-.59,.52,0], [1.37,-.45,.76,1]
    ];
    for (let i = 0; i < 140; i++) {
      const lon = seedBetween(-Math.PI, Math.PI);
      const lat = Math.asin(seedBetween(-.99, .99));
      if (Math.abs(lon) < 1.38 || Land.surface(lon, lat) < .10) continue;
      if (Object.values(Land.landmarks).some((site) => Math.hypot(lon - site.lon, lat - site.lat) < .23)) continue;
      if (treeSites.some(([x, y]) => Math.hypot(lon - x, lat - y) < .15)) continue;
      treeSites.push([lon, lat, seedBetween(.48, 1), random() < .62 ? 1 : 0]);
    }
    for (const [lon, lat, scale, type] of treeSites) {
      positionAt(lon, lat, -.035, random() * tau, scale);
      add('stem', bark, [0,.43,0], [.15,.90,.15], [0,0,-.10]);
      if (type === 0) {
        add('stem', '#896749', [.20,.72,.03], [.09,.69,.09], [0,0,-.58]);
        add('stem', '#876549', [-.24,.69,.04], [.10,.62,.10], [0,0,.64]);
        add('pebble', pick(palette), [-.03,1.21,-.09], [.73,.63,.62]);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * tau;
          const lift = seedBetween(.98, 1.44);
          const r = seedBetween(.27, .52);
          const s = seedBetween(.36, .56);
          add('pebble', pick(palette), [Math.cos(a)*r, lift, Math.sin(a)*r], [s, s * 1.1, s]);
        }
        add('pebble', pick(palette.slice(0, 4)), [.01,1.60,-.08], [.44,.49,.42]);
      } else {
        for (let i = 0; i < 7; i++) {
          const r = .36 - i * .037, a = i * 2.4;
          add('pebble', pick(cypressColors), [Math.cos(a)*r*.35,.37+i*.225,Math.sin(a)*r*.35], [r,.42,r*.85], [0,a,-.14]);
        }
      }
    }

    for (let i = 0; i < 450; i++) {
      const lon = seedBetween(-Math.PI, Math.PI), lat = Math.asin(seedBetween(-1, 1));
      if (Land.surface(lon, lat) < .032 || Land.trailDist(lon, lat) < .058) continue;
      if (Object.values(Land.landmarks).some((site) => Math.hypot(lon - site.lon, lat - site.lat) < .17)) continue;
      const scale = seedBetween(.22, .65);
      positionAt(lon, lat, -.05, random() * tau, scale);
      const stone = random() < .22;
      const colors = stone ? ['#9e9d82', '#a8aa92', '#838e78'] : palette;
      add('pebble', pick(colors), [0,.07,0], [.44,stone ? .29 : .44,.40], [0,.3,0]);
      if (!stone) {
        add('pebble', pick(colors), [.27,.05,-.1], [.32,.31,.30]);
        add('pebble', pick(colors), [-.27,.02,.05], [.29,.24,.31]);
      }
    }

    const flowerSites = [
      [-.30,.36,0], [-.68,.37,3], [-.41,.62,2], [-.15,.54,0], [0,.31,3],
      [.18,.36,1], [.45,.35,0], [.59,.21,2], [-.22,-.28,3], [-.35,-.33,0],
      [-.61,-.31,2], [-.75,-.45,0], [.05,-.43,1], [.21,-.52,5], [.37,-.56,3],
      [.54,-.64,0], [.87,-.65,1], [1.03,-.29,1], [.57,-.19,1], [.18,.65,0]
    ];
    for (let i = 0; i < 210; i++) {
      const lon = seedBetween(-Math.PI, Math.PI), lat = Math.asin(seedBetween(-1, 1));
      if (Land.surface(lon, lat) < .035 || Land.trailDist(lon, lat) < .07) continue;
      if (Object.values(Land.landmarks).some((site) => Math.hypot(lon-site.lon, lat-site.lat) < .13)) continue;
      flowerSites.push([lon, lat, Math.floor(seedBetween(0, petalPalettes.length))]);
    }
    for (const [lon, lat, family] of flowerSites) {
      for (let j = 0; j < 7; j++) {
        const x = lon + seedBetween(-.067, .067), y = lat + seedBetween(-.057, .057);
        if (Land.surface(x, y) < .03) continue;
        const scale = seedBetween(.68, 1.18);
        positionAt(x, y, 0, random() * tau, scale);
        const height = seedBetween(.09, .235);
        add('stem', '#638d43', [0,height*.48,0], [.012,height,.012], [0,0,0], false);
        add('tiny', '#8cb449', [.025,height*.37,0], [.034,.015,.013], [0,0,.6], false);
        const petals = family === 0 || family === 5 ? 4 : 5;
        for (let k = 0; k < petals; k++) {
          const a = k * tau / petals;
          add('tiny', petalPalettes[family], [Math.cos(a)*.029,height,Math.sin(a)*.029], [.026,.018,.019], [0,-a,0], false);
        }
        add('tiny', family === 1 ? '#9d663e' : '#f6cc63', [0,height+.017,0], [.017,.015,.017], null, false);
      }
    }

    for (let i = 0; i < 640; i++) {
      const lon = seedBetween(-Math.PI, Math.PI), lat = Math.asin(seedBetween(-1, 1));
      if (Land.surface(lon, lat) < .032 || Land.trailDist(lon, lat) < .058) continue;
      positionAt(lon, lat, -.02, random() * tau, seedBetween(.5, 1.7));
      for (let j = -1; j < 2; j++) {
        add('tiny', pick(['#8eb058', '#a7c765', '#779c4d']), [j * .033,.061,.016 * j], [.015,.082,.013], [0,0,-j * .34], false);
      }
    }

    for (let i = 0; i < 92; i++) {
      const lon = seedBetween(-Math.PI, Math.PI);
      const bank = random() < .5 ? -1 : 1;
      const lat = Land.river(lon) + (Land.riverWidth(lon) + seedBetween(.04,.08)) * bank;
      if (Math.abs(lon - Land.landmarks.bridge.lon) < .15 || Land.surface(lon, lat) < .024) continue;
      positionAt(lon, lat, 0, random() * tau, seedBetween(.75, 1.32));
      for (let j = 0; j < 3; j++) {
        const x = j * .055 - .055, height = seedBetween(.19, .34);
        add('stem', '#718e44', [x,height*.5,0], [.013,height,.013], [0,0,-x*4], false);
        add('tiny', '#a4785a', [x*1.5,height,0], [.026,.059,.024], [0,0,-x*4], false);
        add('tiny', '#9fb950', [x+.06,.079,0], [.023,.115,.022], [0,0,-.49], false);
      }
    }

    for (const pond of Land.pools) {
      for (let i = 0; i < 22; i++) {
        const a = random() * tau, r = seedBetween(.38, .88);
        const lon = pond.lon + Math.cos(a) * pond.x * r;
        const lat = pond.lat + Math.sin(a) * pond.y * r;
        const level = Land.radius + Land.waterLevel - Land.point(lon, lat).length();
        if (level < .026) continue;
        positionAt(lon, lat, level + .023, a, seedBetween(.54, 1.16));
        add('round', pick(['#75a968', '#96b760', '#80ad68']), [0,0,0], [.142,.021,.106], null, false);
        if (i % 3 === 0) {
          for (let j = 0; j < 5; j++) {
            const angle = j * tau / 5;
            add('tiny', '#ffaca9', [Math.cos(angle)*.037,.048,Math.sin(angle)*.037], [.043,.023,.022], [0,-angle,0], false);
          }
          add('tiny', '#f5d67a', [0,.063,0], [.030,.021,.030], null, false);
        }
      }
    }
    commit();
  }

  function cottage(halo) {
    const { lon, lat } = Land.landmarks.home;
    const house = at(lon, lat, -.02, -.13);
    const wall = '#f4e4bb', clay = '#c67758', trim = '#8e593d', door = '#507d64';
    model(house, 'round', '#c5a778', [0,.10,0], [.78,.13,.66]);
    model(house, 'round', wall, [0,.48,0], [.72,.61,.62]);

    const roofProfile = [[0,1.41],[.15,1.38],[.32,1.27],[.50,1.10],[.65,.91],[.77,.83],[.79,.77],[.77,.73],[.72,.73],[.60,.77],[0,.80]].reverse();
    const roof = new THREE.LatheGeometry(roofProfile.map(([x,y]) => new Vector2(x,y)), 40);
    model(house, roof, clay, [0,0,0], [1,1,.95]);
    for (let layer = 0; layer < 3; layer++) {
      const y = [.83,.96,1.12][layer], r = [.699,.594,.472][layer];
      for (let j = 0; j < 22 - 3 * layer; j++) {
        const a = j * tau / (22 - 3 * layer) + .16 * layer;
        model(house, 'round', pick(['#c87a56','#d38761','#dd8c64','#ce8059']),
          [Math.cos(a)*r,y,Math.sin(a)*r*.95], [.097,.028,.054], [0,-a,0]);
      }
    }
    model(house, 'stem', '#a46953', [-.30,1.28,-.17], [.100,.53,.100], [0,0,.13]);
    model(house, 'stem', '#86533f', [-.34,1.54,-.17], [.14,.075,.126], [0,0,.1]);
    model(house, 'round', trim, [0,.31,.549], [.24,.34,.132]);
    model(house, 'round', door, [0,.31,.647], [.189,.285,.059]);
    for (let i = -1; i < 2; i++) {
      model(house, 'box', '#6a9375', [i*.062,.30,.700], [.008,.43,.01]);
    }
    model(house, 'round', '#e6b96a', [.10,.27,.703], [.030,.031,.029]);
    model(house, 'pebble', '#ba9d77', [0,.05,.775], [.26,.09,.14], [0,.1,0]);
    model(house, 'pebble', '#b59f7b', [.025,.017,.96], [.21,.052,.14], [0,-.3,0]);

    for (const side of [-1, 1]) {
      const window = new Group();
      window.position.set(side * .43, .505, .477);
      window.rotation.y = side * .57;
      house.add(window);
      model(window, 'round', '#ab7652', [0,0,0], [.154,.169,.067]);
      model(window, 'round', windowGlass, [0,0,.045], [.116,.129,.041]);
      halo(window, [0,0,.10], .58, .42);
      model(window, 'box', '#fff0b9', [0,0,.083], [.013,.216,.016]);
      model(window, 'box', '#fff0b9', [0,0,.083], [.189,.014,.016]);
      model(window, 'box', '#926645', [0,-.166,.055], [.286,.080,.122]);
      for (let i = -1; i < 2; i++) {
        model(window, 'tiny', '#789c53', [i*.072,-.10,.09], [.05,.04,.042]);
        model(window, 'tiny', '#f9a6a2', [i*.072,-.067,.116], [.027,.031,.024]);
      }
    }

    for (let i = 0; i < 8; i++) {
      const angle = .11 + i * .45;
      const x = -1.15 + Math.cos(angle)*.38, z = -.19 + Math.sin(angle)*.54;
      model(house, 'stem', pick(wood), [x,.14,z], [.034,.33,.034], [0,0,seedBetween(-.12,.12)]);
    }
    const porchLight = new THREE.PointLight('#ffad62', 0, 3.1, 2);
    porchLight.position.set(0,.67,1.08);
    house.add(porchLight);
    return {house, porchLight};
  }

  function footbridge() {
    const {lon, lat} = Land.landmarks.bridge;
    const level = Land.radius + Land.waterLevel - Land.point(lon,lat).length();
    const bridge = at(lon, lat, level + .085, -.24);
    const curve = (z) => .26 * (1 - (z / .81) ** 2);
    for (let i = -7; i <= 7; i++) {
      const z = i * .117;
      model(bridge, 'box', pick(wood), [0,curve(z),z], [.68,.085,.109], [Math.atan(z * .69),0,0]);
      for (const x of [-.27,.27]) {
        model(bridge, 'tiny', '#6c5140', [x,curve(z)+.044,z], [.015,.010,.015]);
      }
    }
    for (const side of [-1,1]) {
      const x = side * .33;
      for (const z of [-.78,-.38,.01,.41,.79]) {
        model(bridge, 'box', '#906344', [x,curve(z)+.155,z], [.075,.37,.075], [0,0,-side*.11]);
        model(bridge, 'round', '#bc8b57', [x,curve(z)+.348,z], [.061,.027,.057]);
      }
      for (const height of [.17,.31]) {
        const points = Array.from({length: 9}, (_,i) => {
          const z = (i - 4) * .198;
          return new Vector3(x,curve(z)+height,z);
        });
        model(bridge, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 22, .029, 7),
          height > .2 ? '#bd8b56' : '#8f6241', [0,0,0], [1,1,1]);
      }
    }
    return bridge;
  }

  function rabbit(lon, lat, yaw, scale) {
    const base = at(lon, lat, -.015, yaw);
    const actor = new Group();
    actor.scale.setScalar(scale);
    base.add(actor);
    const fur = '#fff0da';
    model(actor, 'round', fur, [0,.21,0], [.24,.23,.32]);
    model(actor, 'round', fur, [0,.33,.23], [.19,.19,.17]);
    model(actor, 'round', '#fff5de', [0,.23,-.317], [.112,.113,.116]);
    model(actor, 'round', '#d99194', [0,.30,.390], [.049,.028,.023]);
    for (const side of [-1,1]) {
      const tilt = -side*.20;
      model(actor, 'round', fur, [side*.086,.524,.19], [.072,.198,.058], [-.22,0,tilt]);
      model(actor, 'round', '#eaa9a3', [side*.096,.544,.240], [.036,.133,.021], [-.22,0,tilt]);
      model(actor, 'tiny', '#3c4e47', [side*.127,.371,.329], [.029,.035,.022], [0,side*.4,0]);
      model(actor, 'round', fur, [side*.151,.081,.12], [.091,.074,.15]);
    }
    return {base, actor};
  }

  function frog() {
    const {lon,lat} = Land.landmarks.pond;
    const x = lon - .04, y = lat + .015;
    const level = Land.radius + Land.waterLevel - Land.point(x,y).length();
    const base = at(x,y,level + .022,-.54);
    model(base, 'pebble', '#939981', [0,.034,0], [.29,.13,.22], [0,.24,0]);
    const body = new Group();
    base.add(body);
    model(body, 'round', '#83b34e', [0,.175,0], [.18,.107,.13]);
    model(body, 'round', '#c6d76e', [0,.143,.072], [.139,.060,.075]);
    for (const side of [-1,1]) {
      model(body, 'round', '#81ac4e', [side*.104,.244,.047], [.064,.065,.057]);
      model(body, 'tiny', '#fff2b5', [side*.104,.253,.083], [.045,.046,.027]);
      model(body, 'tiny', '#344c3d', [side*.106,.253,.106], [.022,.028,.016]);
      model(body, 'round', '#84a844', [side*.146,.132,.054], [.069,.041,.079]);
    }
    return {base, body};
  }

  function windmill() {
    const { lon, lat } = Land.landmarks.mill;
    const mill = at(lon, lat, -.025, -.05);
    model(mill, 'stem', '#ddc594', [0,.45,0], [.38,.89,.38]);
    model(mill, new THREE.ConeGeometry(.43, .50, 12), '#8f6252', [0,1.06,0], [1,1,1]);
    model(mill, 'round', '#886342', [0,.21,.385], [.129,.202,.035]);
    const blades = new Group();
    blades.position.set(0,.76,.36);
    mill.add(blades);
    model(blades, 'round', '#765642', [0,0,.065], [.11,.11,.103]);
    for (let i = 0; i < 4; i++) {
      const spoke = new Group();
      spoke.rotation.z = i * Math.PI / 2;
      blades.add(spoke);
      model(spoke, 'box', '#916c4c', [0,.414,0], [.048,.82,.05]);
      model(spoke, 'box', '#efe1a8', [.111,.533,0], [.153,.46,.036], [0,0,-.10]);
      for (let j = 0; j < 4; j++) model(spoke, 'box', '#a98257', [.103,.38 + j * .104,.026], [.15,.018,.018]);
    }
    return {mill, blades};
  }

  function campfire(lon, lat, halo) {
    const base = at(lon, lat, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = i * tau / 8;
      model(base, 'pebble', pick(['#a3a38a','#b5af97','#8b927f']), [Math.cos(a)*.25,.048,Math.sin(a)*.25], [.084,.062,.089], [0,a,0]);
    }
    for (let i = 0; i < 3; i++) {
      model(base, 'stem', pick(wood), [0,.06+i*.02,0], [.038,.37,.038], [Math.PI/2,i*Math.PI/3,0]);
    }
    const flame = new Group();
    base.add(flame);
    model(flame, 'round', '#ec8b4a', [0,.20,0], [.112,.144,.099], [0,0,.16]);
    model(flame, 'round', flameCore, [.025,.259,.027], [.067,.137,.067], [0,0,-.28]);
    halo(flame, [0,.25,.06], .94, .76);
    const near = new THREE.PointLight('#ffb169', .8, 2.15, 2);
    near.position.y = .36;
    base.add(near);
    return {base, flame, near};
  }

  function lantern(lon, lat, halo) {
    const base = at(lon, lat, -.02, .2);
    model(base, 'stem', '#765a46', [0,.17,0], [.034,.37,.034]);
    model(base, 'stem', '#7e654d', [0,.33,0], [.09,.07,.09]);
    const glass = model(base, 'stem', lanternGlass, [0,.416,0], [.070,.137,.070]);
    glass.castShadow = false;
    for (const x of [-1,1]) {
      for (const z of [-1,1]) {
        model(base, 'box', '#8c6d4b', [x*.049,.418,z*.049], [.015,.144,.015]);
      }
    }
    model(base, new THREE.ConeGeometry(.105,.092,6), '#775d4d', [0,.507,0], [1,1,1]);
    halo(base, [0,.416,0], .74, .54);
    const light = new THREE.PointLight('#ffbd79', 0, 2.5, 2);
    light.position.y = .43;
    base.add(light);
    return {base, light};
  }

  function warmHalos() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const fade = ctx.createRadialGradient(32,32,0,32,32,32);
    fade.addColorStop(0, '#ffffffdb');
    fade.addColorStop(.20, '#ffffff82');
    fade.addColorStop(.48, '#ffffff32');
    fade.addColorStop(1, '#ffffff00');
    ctx.fillStyle = fade;
    ctx.fillRect(0,0,64,64);
    const map = new THREE.CanvasTexture(canvas);
    const sprites = [];
    function create(parent, position, diameter, opacity) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        color: '#ffac57', map, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false
      }));
      sprite.position.fromArray(position);
      sprite.scale.set(diameter, diameter, 1);
      sprite.visible = false;
      parent.add(sprite);
      sprites.push({sprite, opacity});
    }
    function update(night) {
      for (const {sprite, opacity} of sprites) {
        sprite.visible = night > .001;
        sprite.material.opacity = opacity * night;
      }
    }
    return {create, update};
  }

  function fireflies(world) {
    const rand = Land.rng(121997);
    const positions = [], phases = [];
    const sites = [
      ...Object.values(Land.landmarks), {lon: -.13, lat: .31}, {lon: 1.00, lat: -.63},
      {lon: 1.0, lat: .43}, {lon: -.99, lat: -.47}, {lon: 2.62, lat: -.38},
      {lon: -1.4, lat: .57}, {lon: .14, lat: -.75}
    ];
    for (const site of sites) {
      for (let i = 0; i < 11; i++) {
        const lon = site.lon + (rand() - .5) * .64;
        const lat = site.lat + (rand() - .5) * .46;
        positions.push(...Land.point(lon, lat, .17 + rand() * .63).toArray());
        phases.push(rand() * tau);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases,1));
    const uniforms = {
      uTime: {value: 0},
      uNight: {value: 0},
      uPixelRatio: {value: 1}
    };
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float phase;
        uniform float uTime, uPixelRatio;
        varying float vLight;
        void main() {
          float t = uTime + phase;
          vec3 drift = vec3(sin(t * 0.73), sin(t * 1.19), cos(t * 0.91)) * 0.09;
          vec4 viewPosition = modelViewMatrix * vec4(position + drift, 1.0);
          vLight = smoothstep(-0.65, 0.84, sin(uTime * (0.85 + phase * 0.19) + phase * 5.0));
          gl_PointSize = clamp(105.0 / -viewPosition.z, 3.8, 20.0) * uPixelRatio * mix(0.69, 1.0, vLight);
          gl_Position = projectionMatrix * viewPosition;
        }`,
      fragmentShader: `
        uniform float uNight;
        varying float vLight;
        void main() {
          vec2 delta = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(delta, delta);
          float core = exp(-30.0 * r2);
          float fade = 1.0 - smoothstep(0.40, 1.0, r2);
          float aura = exp(-5.0 * r2) * 0.38;
          gl_FragColor = vec4(mix(vec3(0.96, 0.71, 0.19), vec3(1.0, 0.96, 0.61), core),
            (core + aura) * fade * mix(0.07, 0.92, vLight) * uNight);
          #include <colorspace_fragment>
        }`
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    world.add(points);
    return (seconds, night, pixelRatio) => {
      uniforms.uTime.value = seconds;
      uniforms.uNight.value = night;
      uniforms.uPixelRatio.value = pixelRatio;
      points.visible = night > .001;
    };
  }

  function butterflies(world, sites, frameAt = Land.frame, wingColors) {
    const collection = [];
    // A world loaded first should generate the same meadow and butterfly paths.
    const next = sites ? Land.rng(280593) : random;
    const range = (min,max) => min+(max-min)*next();
    const wings = new THREE.Shape();
    wings.moveTo(0,0);
    wings.quadraticCurveTo(.026,.11,.091,.099);
    wings.quadraticCurveTo(.144,.072,.083,.019);
    wings.quadraticCurveTo(.097,-.038,.048,-.061);
    wings.quadraticCurveTo(.015,-.071,0,0);
    const geo = new THREE.ShapeGeometry(wings, 8);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide });
    const count = sites?.length ?? 31;
    const wingsBatch = new THREE.InstancedMesh(geo, material, count * 2);
    wingsBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wingsBatch.frustumCulled = false;
    world.add(wingsBatch);
    const colors = ['#f4ae6b', '#f3de73', '#89bfd1', '#e990b3', '#e7d9f1'];
    for (let i = 0; i < count; i++) {
      const [lon,lat] = sites?.[i] ?? [i < 15 ? range(-1.18,1.22) : range(-Math.PI,Math.PI),range(-.85,.96)];
      const {position,rotation} = frameAt(lon,lat,range(.26,.73));
      rotation.multiply(new Quaternion().setFromAxisAngle(up,next()*tau));
      const color = new Color(wingColors?.[i % wingColors.length] ?? colors[Math.floor(next()*colors.length)]);
      wingsBatch.setColorAt(i * 2, color);
      wingsBatch.setColorAt(i * 2 + 1, color);
      const phase = next() * tau;
      collection.push({anchor:new THREE.Matrix4().compose(position,rotation,new Vector3(1,1,1)), phase, scale:range(.56,.96)});
    }

    const insect = new THREE.Object3D();
    insect.rotation.x = -.83;
    const pose = new THREE.Matrix4();
    const wing = new THREE.Matrix4();
    return (seconds) => {
      for (const [i, {anchor, phase, scale}] of collection.entries()) {
        const a = seconds * .59 + phase;
        insect.position.set(.28*Math.cos(a), .13*Math.sin(a*1.71), .24*Math.sin(a));
        insect.rotation.z = a + phase;
        insect.scale.setScalar(scale);
        insect.updateMatrix();
        const flap = Math.sin(seconds * 22 + phase) * 1.01;
        pose.multiplyMatrices(anchor, insect.matrix);
        wingsBatch.setMatrixAt(i * 2, wing.makeRotationY(flap).premultiply(pose));
        wingsBatch.setMatrixAt(i * 2 + 1, wing.makeRotationY(Math.PI - flap).premultiply(pose));
      }
      wingsBatch.instanceMatrix.needsUpdate = true;
    };
  }

  function create(world) {
    garden(world);
    const halos = warmHalos();
    const home = cottage(halos.create);
    const bridge = footbridge();
    const one = rabbit(-.66,.30,-.81, .77);
    const two = rabbit(-.56,-.49,.76, .71);
    const three = rabbit(-.88,-.54,1.30,.87);
    const hopper = frog();
    const mill = windmill();
    const far = Land.landmarks.camp;
    const camp = campfire(far.lon, far.lat, halos.create);
    const smallFire = campfire(-.38,-.52, halos.create);
    const northLamp = lantern(.095, .20, halos.create);
    const southLamp = lantern(.29, -.24, halos.create);
    const trailLamp = lantern(-.27, .245, halos.create);
    const lanterns = [northLamp, southLamp, trailLamp];
    world.add(home.house,bridge,one.base,two.base,three.base,hopper.base,mill.mill,camp.base,smallFire.base);
    for (const {base} of lanterns) world.add(base);
    for (const root of [home.house, bridge, one.actor, two.actor, three.actor, hopper.body, mill.blades]) {
      batchRepeatedParts(root);
    }
    batchRepeatedParts(mill.mill, mill.blades);
    batchRepeatedParts(camp.base, camp.flame);
    batchRepeatedParts(smallFire.base, smallFire.flame);
    for (const {base} of lanterns) batchRepeatedParts(base);
    const animateButterflies = butterflies(world);
    const animateFireflies = fireflies(world);

    return (seconds, night, pixelRatio) => {
      windowGlass.emissiveIntensity = night * 2.3;
      lanternGlass.emissiveIntensity = night * 2.0;
      flameCore.emissiveIntensity = night * 1.4;
      home.porchLight.intensity = night * 4.2;
      for (const {light} of lanterns) light.intensity = night * 1.25;
      halos.update(night);
      animateFireflies(seconds, night, pixelRatio);
      animateButterflies(seconds);
      [one,two,three].forEach(({actor}, i) => {
        const cycle = (seconds + i*1.27) % 5.4;
        const hop = cycle < .84 ? Math.sin(cycle / .84 * Math.PI) ** 2 : 0;
        actor.position.y = hop * .20;
        actor.position.z = (1-Math.cos(seconds*.65+i))*.11;
        actor.rotation.x = hop * -.14;
      });
      hopper.body.scale.y = 1 + .062 * Math.sin(seconds * 2.1);
      mill.blades.rotation.z = seconds * .43;
      camp.flame.scale.y = 1 + Math.sin(seconds * 10) * .14;
      smallFire.flame.scale.y = 1 + Math.sin(seconds * 11 + 1) * .12;
      camp.near.intensity = .8 + night * (1.5 + Math.sin(seconds * 7) * .22);
      smallFire.near.intensity = .8 + night * (1.5 + Math.sin(seconds * 8 + 1) * .22);
    };
  }

  return { create, model, makeDecoration, batchRepeatedParts, butterflies };
})();

;
const Inhabitants = (() => {
  const { Group, Mesh, MeshBasicMaterial, Vector3 } = THREE;
  const { model: sceneryPart, batchRepeatedParts } = Scenery;
  const { lerp, smoothstep } = THREE.MathUtils;
  const tau = Land.tau;
  const outfits = {
    gardener: { skin:'#84ae68', top:'#f3ead1', bib:'#527c99', trousers:'#6786a3', boots:'#895d49', accent:'#eac46b' },
    grower: { skin:'#f3bf88', top:'#eedba1', bib:'#a35f63', trousers:'#805d63', boots:'#805a3c', accent:'#dba16a' },
    fisher: { skin:'#eda370', top:'#558c82', bib:'#437a77', trousers:'#5b697e', boots:'#784e43', accent:'#d77857' },
    visitor: { skin:'#85b8d0', top:'#f5d77d', bib:'#b688bc', trousers:'#588196', boots:'#905f89', accent:'#df91c1' },
    traveler: { skin:'#ffd097', top:'#62a69b', bib:'#467d7c', trousers:'#6e7491', boots:'#825c53', accent:'#da8964' },
    stargazer: { skin:'#f3c394', top:'#729489', bib:'#759589', trousers:'#6e8779', boots:'#946951', accent:'#dfad60' },
    maker: { skin:'#eeb58a', top:'#e7c684', bib:'#5a7882', trousers:'#727889', boots:'#7a553e', accent:'#896454' }
  };
  const earGeometry = new THREE.ConeGeometry(1,1,3);
  const shadeGeometry = new THREE.CircleGeometry(1,22).rotateX(-Math.PI/2);
  const shadeMaterial = new MeshBasicMaterial({color:'#312a25',transparent:true,opacity:.12,depthWrite:false});

  function model(...args) {
    const part = sceneryPart(...args);
    part.castShadow = false;
    return part;
  }

  function limb(parent,x,y,z=0) {
    const group = new Group();
    group.position.set(x,y,z);
    parent.add(group);
    return group;
  }

  function resident(parent, kind, scale = 1) {
    const outfit = outfits[kind];
    const base = new Group();
    base.scale.setScalar(scale);
    parent.add(base);
    const shadow = new Mesh(shadeGeometry,shadeMaterial);
    shadow.position.y = .003;
    shadow.scale.set(.139,1,.091);
    base.add(shadow);
    const body = new Group();
    base.add(body);
    const torso = new Group();
    body.add(torso);
    sceneryPart(torso,'round',outfit.top,[0,.328,0],[.112,.150,.089]);
    model(torso,'round',outfit.bib,[0,.246,.006],[.108,.076,.084]);
    model(torso,'box',outfit.bib,[0,.322,.076],[.136,.111,.027]);
    model(torso,'round',outfit.accent,[0,.412,.018],[.097,.041,.082]);
    for (const side of [-1,1]) {
      model(torso,'box',outfit.bib,[side*.054,.391,.063],[.023,.100,.030],[.315,0,side*.12]);
    }
    batchRepeatedParts(torso);

    const head = limb(body,0,.523,.013);
    sceneryPart(head,'round',outfit.skin,[0,0,0],[.125,.124,.111]);
    model(head,'round',kind === 'fisher' ? '#f8d2a7' : outfit.skin,[0,-.056,.080],[.084,.047,.052]);
    for (const side of [-1,1]) {
      model(head,'tiny','#3a493f',[side*.037,.009,.103],[.016,.020,.013]);
      model(head,'tiny','#e5a28d',[side*.074,-.035,.091],[.019,.012,.009],[0,side*.45,0]);
    }
    if (kind === 'gardener' || kind === 'grower') {
      sceneryPart(head,'round','#eac46b',[0,.086,0],[.164,.028,.156],[.02,0,.09]);
      model(head,'round','#edcc79',[0,.127,0],[.098,.064,.095],[0,0,.06]);
      model(head,'round','#b48652',[0,.106,0],[.101,.025,.099]);
    } else if (kind === 'fisher') {
      for (const side of [-1,1]) {
        model(head,earGeometry,'#be7958',[side*.083,.108,-.005],[.057,.123,.054],[.20,side*.23,-side*.22]);
        model(head,earGeometry,'#f2bd9d',[side*.083,.095,.023],[.037,.077,.030],[.18,side*.23,-side*.22]);
      }
      model(head,'tiny','#71493d',[0,-.031,.129],[.019,.014,.010]);
      model(head,'round','#567f6f',[0,.095,-.006],[.098,.037,.104]);
    } else if (kind === 'traveler') {
      sceneryPart(head,'round','#ecd097',[0,.100,0],[.151,.039,.151],[0,0,-.16]);
      model(head,'round','#c29262',[0,.132,-.014],[.109,.064,.100],[0,0,-.14]);
      model(head,'round','#719e90',[0,.110,-.013],[.115,.024,.106],[0,0,-.14]);
    } else if (kind === 'stargazer') {
      model(head,'round','#d4a45e',[0,.057,-.044],[.129,.098,.104],[0,0,-.15]);
      model(head,'pebble','#e9ba70',[.025,.102,.049],[.119,.055,.085],[.11,.28,-.33]);
      model(head,'pebble','#dbab63',[-.075,.074,.057],[.059,.051,.067],[.16,-.3,-.45]);
      model(head,'pebble','#eac375',[-.046,.128,-.009],[.070,.069,.061],[0,0,.40]);
    } else if (kind === 'maker') {
      model(head,'round','#546473',[0,.067,-.009],[.125,.086,.114]);
      model(head,'round','#475661',[0,.075,.092],[.112,.018,.091],[.20,0,-.065]);
      model(head,'tiny','#bb8c64',[0,.149,-.037],[.029,.020,.029]);
    } else {
      model(head,'round','#575a82',[0,.074,-.023],[.116,.071,.083]);
      for(const side of [-1,1]) {
        model(head,'round','#cb7eaf',[side*.122,.021,0],[.030,.056,.057]);
        model(head,'round','#f0b5cb',[side*.139,.020,.004],[.016,.044,.043]);
      }
    }
    batchRepeatedParts(head);
    const legs = [], arms = [], hands = [];
    for (const side of [-1,1]) {
      const leg = limb(body,side*.054,.193);
      sceneryPart(leg,'round',outfit.trousers,[0,-.057,0],[.042,.088,.043]);
      model(leg,'round',outfit.boots,[0,-.145,.022],[.052,.042,.073]);
      legs.push(leg);
      const arm = limb(body,side*.105,.382,.003);
      sceneryPart(arm,'round',outfit.top,[0,-.057,0],[.037,.079,.039]);
      const hand = limb(arm,0,-.129,.004);
      model(hand,'round',outfit.skin,[0,0,0],[.032,.033,.031]);
      arms.push(arm);
      hands.push(hand);
    }

    function pose(seconds, walk = 0, reach = 0, wave = 0, gesture = {}) {
      const step = Math.sin(seconds*tau*1.55)*walk;
      const seated = gesture.seated ?? 0;
      for (const [i,leg] of legs.entries()) {
        const side=i===0?-1:1;
        leg.rotation.x=step*side*.65-seated*1.32;
        leg.rotation.z=side*seated*.16;
      }
      arms[0].rotation.set(step*.44-(gesture.leftReach ?? 0),0,.16+(gesture.leftRoll ?? 0));
      arms[1].rotation.set(-step*.43-reach,0,-.16 + wave*(1.99+.28*Math.sin(seconds*12))+(gesture.rightRoll ?? 0));
      body.position.y = Math.abs(step)*.032 + Math.sin(seconds*3.25)*.007-(gesture.crouch ?? 0)-seated*.111;
      body.rotation.x = .06*walk + reach*.08+(gesture.lean ?? 0);
      head.rotation.x = gesture.lookDown ?? 0;
      head.rotation.y = Math.sin(seconds*.88)*.108+(gesture.lookAside ?? 0);
      head.rotation.z = wave*.10;
    }
    return {base, torso, head, hands, pose};
  }

  function fisher(area, dockEnd, floatPoint) {
    const person = resident(area,'fisher',1.08);
    person.base.name = 'Золотой берег: рыбак';
    const rod = limb(person.hands[1],.02,-.008,.032);
    model(rod,'stem','#855341',[0,.273,0],[.015,.546,.015]);
    model(rod,'stem','#b88962',[0,.588,0],[.010,.236,.010]);
    model(rod,'round','#d9a565',[.036,.118,0],[.033,.043,.031]);
    const bob = model(area,'round','#e17c69',[0,0,0],[.050,.043,.047]);
    const lineGeometry = new THREE.BufferGeometry();
    const linePosition = new THREE.BufferAttribute(new Float32Array(9),3);
    lineGeometry.setAttribute('position',linePosition);
    const line = new THREE.Line(lineGeometry,new THREE.LineBasicMaterial({color:'#ffdfad',transparent:true,opacity:.7}));
    line.frustumCulled = false;
    area.add(line);
    const tip = new Vector3(), end = new Vector3();
    return (seconds) => {
      const t = seconds % 11.6;
      const out = smoothstep(t,.02,2.92);
      const back = smoothstep(t,7.0,10.05);
      const progress = out-back;
      const z = lerp(.25,dockEnd,progress);
      const walk = Math.max(smoothstep(t,0,.22)*(1-smoothstep(t,2.63,2.95)),
        smoothstep(t,6.99,7.27)*(1-smoothstep(t,9.77,10.1)));
      const cast = smoothstep(t,3.0,3.68)*(1-smoothstep(t,6.13,6.85));
      const face = smoothstep(t,6.22,7.03) - smoothstep(t,10.07,11.1);
      person.base.position.set(lerp(-.59,-.45,progress),.051-z*.10,z);
      person.base.rotation.y = .13 + Math.PI*face;
      person.pose(seconds,walk,.23 + cast*.58 + Math.sin(t*9)*cast*.052);
      rod.rotation.x = .69 + cast*1.24 + .10*Math.sin(seconds*2);
      bob.visible = line.visible = cast > .06;
      if (!line.visible) return;
      area.worldToLocal(rod.localToWorld(tip.set(0,.705,0)));
      const rigging = smoothstep(cast,.06,.97);
      end.copy(floatPoint);
      end.y += .009*Math.sin(seconds*5);
      end.z += .026*Math.sin(seconds*2);
      end.lerp(tip,1-rigging);
      end.y += (1-rigging)*rigging*.30;
      linePosition.setXYZ(0,tip.x,tip.y,tip.z);
      linePosition.setXYZ(1,(tip.x+end.x)*.5,(tip.y+end.y)*.5-.075*rigging,(tip.z+end.z)*.5);
      linePosition.setXYZ(2,end.x,end.y,end.z);
      linePosition.needsUpdate = true;
      bob.position.copy(end);
    };
  }

  function pondVisitor(world,pier,target) {
    const person = resident(world,'visitor',.99);
    person.base.name = 'Пруд кувшинок: житель';
    const depot = new Group();
    depot.name = 'Ящик с кормом у начала пристани';
    const bank = pier.sample(.02);
    const beside = new Vector3(-.39,0,.025).applyQuaternion(bank.rotation);
    depot.position.copy(bank.position).add(beside);
    depot.quaternion.copy(bank.rotation);
    world.add(depot);
    model(depot,'box','#9e7855',[0,.10,0],[.24,.20,.24]);
    model(depot,'box','#c29e69',[0,.20,0],[.267,.047,.257]);
    model(depot,'stem','#876956',[0,.237,0],[.089,.042,.086]);
    for(const [x,z] of [[.027,0],[-.031,.024],[.011,-.034]]) {
      model(depot,'tiny','#edd69c',[x,.263,z],[.024,.016,.020]);
    }
    const food=model(person.hands[1],'tiny','#ead49c',[0,.006,.027],[.034,.024,.032]);
    food.name='Корм в руке';
    const tossed=new Group();
    tossed.name='Корм летит к лягушке';
    world.add(tossed);
    for(let i=0;i<4;i++) model(tossed,'tiny','#f5d79c',[.032*Math.cos(i*2.4),.017*i,.032*Math.sin(i*2.4)],[.026,.021,.021]);
    const cycle = 15.6, throwAt=5.78, landingAt=throwAt+.72;
    const grip=new Vector3(), destination=new Vector3(), up=new Vector3(), facing=new Vector3();
    let epoch=0;
    return {
      trigger(seconds) {
        const t=(seconds-epoch)%cycle;
        if(t>=13.8) epoch=seconds;
      },
      animate(seconds) {
        const t = (seconds-epoch)%cycle;
        const outward=smoothstep(t,1.62,5.05), inward=smoothstep(t,9.45,13.48);
        const scoop=smoothstep(t,.19,.60)-smoothstep(t,1.08,1.53);
        const toss=smoothstep(t,5.30,throwAt)-smoothstep(t,throwAt+.12,6.28);
        const stroll=smoothstep(t,1.64,1.92)-smoothstep(t,4.83,5.07)
          +smoothstep(t,9.44,9.70)-smoothstep(t,13.23,13.50);
        const walkAlong=pier.sample(lerp(.02,.95,outward-inward));
        person.base.position.copy(walkAlong.position).multiplyScalar(1.002);
        person.base.position.addScaledVector(beside,scoop*.50);
        person.base.quaternion.copy(walkAlong.rotation);
        person.base.rotateY(-1.43*(1-smoothstep(t,1.12,1.68)));
        target(destination);
        facing.copy(destination).sub(person.base.position);
        const atEnd=smoothstep(t,4.83,5.43)-smoothstep(t,8.8,9.34);
        if (atEnd>0) person.base.quaternion.slerp(Landforms.walkingFrame(person.base.position,facing),atEnd);
        person.base.rotateY(Math.PI*(smoothstep(t,8.72,9.42)-smoothstep(t,13.47,13.79))
          -1.43*smoothstep(t,13.47,13.79));
        person.pose(seconds,.92*stroll,.14+.93*toss+.64*scoop,.12*toss);
        food.visible=t>=.76 && t<throwAt;
        tossed.visible=t>=throwAt && t<landingAt;
        if (tossed.visible) {
          const progress=(t-throwAt)/(landingAt-throwAt);
          person.pose(seconds-t+throwAt,0,1.07,.12);
          world.worldToLocal(person.hands[1].localToWorld(grip.set(0,.006,.027)));
          person.pose(seconds,.92*stroll,.14+.93*toss+.64*scoop,.12*toss);
          tossed.position.copy(grip).lerp(destination,progress)
            .addScaledVector(up.copy(destination).normalize(),.51*Math.sin(Math.PI*progress));
          tossed.rotation.y=progress*2.45;
          tossed.scale.setScalar(1-.24*progress);
        }
        return t>=landingAt ? seconds-t+landingAt : epoch>0 ? -Infinity : seconds-t-cycle+landingAt;
      }
    };
  }

  function gardener(area) {
    const person = resident(area,'gardener',1.02);
    person.base.name = 'Луговая планета: садовник';
    const can = limb(person.hands[1],.014,-.017,.044);
    model(can,'round','#c28a69',[0,-.019,0],[.053,.050,.059]);
    model(can,'stem','#d19a76',[.009,-.014,.058],[.015,.100,.013],[1.90,0,0]);
    model(can,'round','#e1ae83',[.009,.001,.119],[.020,.019,.021]);
    model(can,'ring','#e5b183',[0,.010,-.030],[.033,.036,.034]);
    const cycle = 9.5, waterAt = 3.14;
    const tip = new Vector3();
    return {
      cycle, waterAt,
      spout() { return area.worldToLocal(can.localToWorld(tip.set(.009,.001,.119))); },
      animate(seconds, sinceWater) {
        const t = seconds % cycle;
        const walkUp = smoothstep(t,.03,2.63)-smoothstep(t,5.41,8.31);
        const stroll = Math.max(smoothstep(t,.04,.25)*(1-smoothstep(t,2.34,2.66)),
          smoothstep(t,5.40,5.66)*(1-smoothstep(t,8.10,8.35)));
        const pour = smoothstep(sinceWater,0,.18)*(1-smoothstep(sinceWater,.85,1.25));
        const path = lerp(walkUp,1,pour);
        person.base.position.set(lerp(-.96,-.51,path),.012,lerp(-.27,.124,path));
        const facing = .85 + .60*smoothstep(t,2.45,3.1)
          + Math.PI*(smoothstep(t,5.04,5.46)-smoothstep(t,8.31,9.34));
        person.base.rotation.y = lerp(facing,1.94,pour);
        person.pose(seconds,stroll*(1-pour),.20 + pour*.93);
        can.rotation.x = pour*.72;
      }
    };
  }

  function flyers(parent, kind, frameAt) {
    const locations = kind === 'shore'
      ? [[-.66,.38],[1.66,.28],[-2.17,-.19]]
      : [[-.51,.09],[1.76,-.38],[-2.32,.37]];
    const animals = locations.map(([lon,lat],i) => {
      const {position,rotation} = frameAt(lon,lat,.42+i*.04);
      const anchor = new Group();
      anchor.position.copy(position);
      anchor.quaternion.copy(rotation);
      parent.add(anchor);
      const actor = new Group();
      anchor.add(actor);
      const bird = kind === 'shore';
      model(actor,'round',bird ? '#f4ecce' : '#69bacc',[0,0,0],[bird ? .052 : .022,.039,.103]);
      model(actor,'tiny',bird?'#dba262':'#467c83',[0,.008,.099],[.028,.025,.034]);
      const wings = [-1,1].map((side) => {
        const wing = limb(actor,side*.031,0,-.022);
        model(wing,'tiny',bird ? '#fff0c9' : '#b3e5dd',[side*(bird ? .085 : .053),.001,.020],
          [bird ? .111 : .075,.015,bird ? .045 : .020],[0,-side*.28,0]);
        return wing;
      });
      return {actor,wings,phase:i*2.36,bird};
    });
    return (seconds) => {
      for (const {actor,wings,phase,bird} of animals) {
        const a = seconds*(bird ? .91 : 1.36)+phase;
        actor.position.set(Math.cos(a)*.35,.071*Math.sin(a*2.0),Math.sin(a)*.27);
        actor.rotation.y = -a;
        const flap = Math.sin(seconds*(bird?13:25)+phase)*.78;
        wings[0].rotation.z = -flap;
        wings[1].rotation.z = flap;
      }
    };
  }

  return { resident, fisher, pondVisitor, gardener, flyers };
})();

;
const Landforms = (() => {
  const { Group, Mesh, Vector3, Matrix4 } = THREE;
  const { model, batchRepeatedParts, makeDecoration } = Scenery;
  const { lerp, smoothstep } = THREE.MathUtils;
  const tau = Land.tau;
  const waterRadius = Land.radius+Land.waterLevel;
  const wrap = (lon) => THREE.MathUtils.euclideanModulo(lon+Math.PI,tau)-Math.PI;
  const islands = {
    palms:{lon:-.65,lat:-.54,x:.30,y:.235},
    pines:{lon:.73,lat:-.54,x:.315,y:.25},
    lighthouse:{lon:2.21,lat:-.47,x:.36,y:.24},
    reef:{lon:-2.12,lat:-.63,x:.285,y:.205}
  };
  const harbor = {lon:.01,lat:.135};
  const village = {lon:-1.42,lat:.34};
  const waterfall = {lon:.49,lat:.44};
  const camp = {lon:2.34,lat:.46};
  const stops = {
    shore: [
      {label:'Islands',...islands.palms,zoom:.48},
      {label:'Lighthouse',...islands.lighthouse,zoom:.61,tilt:.25},
      {label:'Harbor',...harbor,zoom:.59}
    ],
    pond: [
      {label:'Waterfall',...waterfall,zoom:.69},
      {label:'Camp',...camp,zoom:.66}
    ]
  };
  const routes = {
    pond: {start:{lon:-.92,lat:-.035},end:{lon:-.265,lat:-.183}},
    district: {start:{lon:.29,lat:-.36},end:{lon:.64,lat:-.39}}
  };

  function coast(lon) {
    return .025 + .11*Math.sin(lon*3+.45) + .085*Math.sin(lon*2-.75);
  }

  function shoreMargin(lon,lat) {
    let margin = lat-coast(lon);
    for (const island of Object.values(islands)) {
      const x = wrap(lon-island.lon)/island.x, y = (lat-island.lat)/island.y;
      const shore = 1-Math.hypot(x,y)+.069*Math.sin(Math.atan2(y,x)*3+.5);
      margin = Math.max(margin,shore*island.y);
    }
    return margin;
  }

  function reserve(kind,lon,lat) {
    if (kind==='shore' && ShoreLife.reserve(lon,lat)) return true;
    if (kind==='pond' && PondInsects.reserve(lon,lat)) return true;
    const sites = kind === 'shore' ? [harbor,village,...Object.values(islands)] : kind === 'pond' ? [waterfall,camp,routes.pond.start] : [];
    return sites.some((spot) => Math.hypot(wrap(lon-spot.lon)*Math.cos(lat),lat-spot.lat) < .18);
  }

  function place(world, surface, spot, lift = 0, yaw = 0) {
    const {position,rotation} = surface.frameAt(spot.lon,spot.lat,lift);
    const root = new Group();
    root.position.copy(position);
    root.quaternion.copy(rotation);
    root.rotateY(yaw);
    world.add(root);
    return root;
  }

  function walkingFrame(position, tangent) {
    const up = position.clone().normalize();
    const z = tangent.addScaledVector(up,-tangent.dot(up)).normalize();
    const x = up.clone().cross(z);
    return new THREE.Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,up,z));
  }

  function boardwalk(world, surface, route) {
    const boards = new Group();
    boards.name = 'Пристань с подходом с берега';
    world.add(boards);
    const {start,end,curve=.026} = route;
    function coordinates(u) {
      return [lerp(start.lon,end.lon,u),lerp(start.lat,end.lat,u)+curve*Math.sin(u*Math.PI)];
    }
    function point(u) {
      const [lon,lat] = coordinates(u);
      const ground = surface.point(lon,lat).length();
      return Land.direction(lon,lat).multiplyScalar(Math.max(ground+.054,waterRadius+.094));
    }
    function sample(u) {
      const position = point(u);
      const tangent = point(u+.008).sub(point(u-.008));
      return {position,rotation:walkingFrame(position,tangent)};
    }
    const length = point(1).distanceTo(point(0));
    const pieces = Math.ceil(length/.113);
    const colors = ['#a87450','#b1845d','#bf956c'];
    for (let i=0;i<=pieces;i++) {
      const u=i/pieces;
      const {position,rotation}=sample(u);
      const plank=model(boards,'box',colors[i%3],[0,0,0],[i >= pieces-2 ? .66 : .52,.075,length/pieces+.008]);
      plank.position.copy(position).addScaledVector(position.clone().normalize(),-.035);
      plank.quaternion.copy(rotation);
      if (i%4!==0 && i!==pieces) continue;
      const depth=position.length()-(waterRadius-.19);
      for(const side of [-1,1]) {
        const leg=model(boards,'stem','#825b43',[0,0,0],[.044,depth+.065,.043]);
        leg.quaternion.copy(rotation);
        leg.position.copy(new Vector3(side*.225,-depth*.5+.032,0).applyQuaternion(rotation).add(position));
      }
    }
    for(let i=1;i<=4;i++) {
      const [lon,lat]=coordinates(-.12*i);
      if (surface.point(lon,lat).length() < waterRadius+.045) continue;
      const frame=surface.frameAt(lon,lat,.026);
      const stone = model(boards,'pebble',i%2?'#a4aa86':'#949a7e',[0,0,0],[.23,.054,.11]);
      stone.position.copy(frame.position);
      stone.quaternion.copy(frame.rotation);
      stone.rotateY(i*.73);
    }
    batchRepeatedParts(boards);
    return { sample };
  }

  const glass = () => new THREE.MeshStandardMaterial({color:'#f1ce8e',emissive:'#ffaf4e',emissiveIntensity:0,roughness:.63});
  function lamp(root,x,y,z,mini) {
    const lantern = new Group();
    lantern.position.set(x,y,z);
    root.add(lantern);
    model(lantern,'stem','#815940',[0,.31,0],[.032,.64,.032]);
    model(lantern,'box','#946040',[.075,.627,0],[.17,.034,.036]);
    const pane = glass();
    model(lantern,'box',pane,[.129,.515,0],[.115,.146,.105]);
    model(lantern,'box','#795142',[.129,.594,0],[.143,.054,.133]);
    model(lantern,'box','#795142',[.129,.433,0],[.124,.028,.115]);
    const light = new THREE.PointLight('#ffb05b',0,1.65,2);
    light.position.set(.14,.51,.025);
    if (!mini) lantern.add(light);
    return (seconds,night) => {
      pane.emissiveIntensity = night*(1.55+.11*Math.sin(seconds*2.5+x));
      light.intensity = night*.68;
    };
  }

  const cone = new THREE.ConeGeometry(1,1,7);
  function pines(root) {
    for(const [x,z,s] of [[-.36,-.25,.94],[.29,-.30,1.12],[.44,.16,.77],[-.49,.32,.64]]) {
      model(root,'stem','#8d6847',[x,s*.38,z],[.065,s*.78,.062]);
      for(let i=0;i<3;i++) {
        model(root,cone,i===2?'#588765':'#346d61',[x,s*(.60+i*.264),z],[s*(.31-i*.052),s*.52,s*(.31-i*.05)],[0,i*.3,0]);
      }
    }
    for(const [x,z,s] of [[.14,.09,.33],[-.20,-.58,.21],[.36,.41,.24]]) {
      model(root,'pebble','#87918a',[x,s*.25,z],[s,s*.55,s*.71],[.1,z,0]);
    }
    model(root,'stem','#a0744f',[-.17,.074,.38],[.092,.64,.092],[0,0,1.53]);
    model(root,'round','#7b9c5d',[-.17,.137,.38],[.25,.045,.075]);
    batchRepeatedParts(root);
  }

  const frond = (() => {
    const geometry = new THREE.BufferGeometry();
    const vertices=[], indices=[];
    for(let i=0;i<=7;i++) {
      const t=i/7, width = Math.sin(t*Math.PI)*.175;
      const y = .27*Math.sin(t*Math.PI)-.21*t*t;
      vertices.push(-width,y-.065*Math.sin(t*Math.PI),t,0,y,t,width,y-.065*Math.sin(t*Math.PI),t);
      if(!i) continue;
      const a=(i-1)*3;
      indices.push(a,a+3,a+1,a+1,a+3,a+4,a+1,a+4,a+2,a+2,a+4,a+5);
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.computeVertexNormals();
    return geometry;
  })();
  const palmColors = ['#61a967','#77b668','#538f58'].map((color) => new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:.9}));
  function palms(root, count) {
    const crowns=[];
    for (const [i,[x,z,size,lean]] of [[-.34,-.02,1.12,-.17],[.34,-.24,.87,.12],[.29,.33,.72,.09]].slice(0,count).entries()) {
      const palm=new Group();
      palm.position.set(x,-.027,z);
      palm.scale.setScalar(size);
      root.add(palm);
      for(let j=0;j<8;j++) {
        const t=j/7;
        model(palm,'stem',j%2?'#bd9a63':'#a88a57',[lean*t*t,.08+j*.101,.072*t*t],
          [.115-.053*t,.153,.110-.048*t],[0,0,-lean*t*.7]);
      }
      const crown=new Group();
      crown.position.set(lean,.855,.071);
      palm.add(crown);
      for (let j=0;j<7;j++) {
        model(crown,frond,palmColors[j%3],[0,0,0],[1,.86,.57+.12*Math.cos(j*2.6)],[0,j*tau/7+i*.36,0]);
      }
      for(const dx of [-.077,.058]) model(crown,'round','#876e49',[dx,-.034,.038],[.049,.054,.045]);
      batchRepeatedParts(crown);
      crowns.push(crown);
    }
    for(const [x,z,s] of [[-.47,.29,.19],[.02,-.51,.25],[.48,.15,.16]]) {
      model(root,'pebble','#c29d76',[x,s*.13,z],[s,s*.38,s*.74],[0,z,0]);
    }
    return (seconds) => {
      for (const [i,crown] of crowns.entries()) {
        crown.rotation.x=.048*Math.sin(seconds*1.43+i*1.21);
        crown.rotation.z=.061*Math.sin(seconds*1.02+i*.67);
      }
    };
  }

  function beacon(root,mini) {
    model(root,'pebble','#a7846b',[.35,-.025,.16],[.42,.24,.31]);
    model(root,'pebble','#b89877',[-.33,.025,-.18],[.41,.29,.34],[0,.63,0]);
    for (let i=0;i<5;i++) {
      model(root,'stem',i%2?'#b96250':'#f0dfb0',[0,.135+i*.138,0],[.25-i*.016,.145,.25-i*.016]);
    }
    model(root,'box','#77564b',[0,.129,.236],[.103,.188,.041]);
    model(root,'stem','#806b57',[0,.805,0],[.262,.075,.262]);
    const panel = glass();
    model(root,'stem',panel,[0,.93,0],[.154,.211,.154]);
    model(root,cone,'#934944',[0,1.115,0],[.245,.196,.245]);
    const badge = new Group();
    badge.name='Эмблема маяка';
    badge.position.set(0,.448,.215);
    root.add(badge);
    model(badge,'round','#4f786a',[0,0,0],[.111,.105,.027]);
    model(badge,'box','#f9e6b2',[0,-.014,.026],[.034,.079,.012]);
    model(badge,cone,'#f9e6b2',[0,.032,.028],[.043,.030,.012]);
    for (const side of [-1,1]) {
      model(badge,'box','#f9e6b2',[side*.048,.028,.026],[.030,.010,.011],[0,0,side*.25]);
    }
    const beam = new Group();
    beam.name='Вращающийся луч маяка';
    beam.position.y=.942;
    root.add(beam);
    const glint = new THREE.MeshBasicMaterial({color:'#ffe4a2',transparent:true,opacity:0,depthWrite:false});
    model(beam,'round',glint,[0,0,.168],[.089,.074,.029]);
    const radiance = {value:0};
    if (!mini) {
      const coneLight = new Mesh(new THREE.ConeGeometry(.37,1.92,19,1,true),new THREE.ShaderMaterial({
        uniforms:{uRadiance:radiance},transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        vertexShader:`
          varying float vReach;
          void main() {
            vReach=clamp((position.y+.96)/1.92,0.0,1.0);
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
          }`,
        fragmentShader:`
          varying float vReach;
          uniform float uRadiance;
          void main() {
            gl_FragColor=vec4(1.0,.80,.47,pow(vReach,1.65)*uRadiance*.16);
          }`
      }));
      coneLight.rotateX(-Math.PI/2);
      coneLight.position.z=1.11;
      beam.add(coneLight);
    }
    const glow = new THREE.PointLight('#ffc575',0,2.3,2);
    glow.position.y=1.02;
    if (!mini) root.add(glow);
    batchRepeatedParts(root,beam);
    return (seconds,night) => {
      panel.emissiveIntensity=.68+night*1.20;
      beam.rotation.y=seconds*1.43;
      radiance.value=.58+night*.42;
      glint.opacity=.55+night*.31;
      glow.intensity=night*(1.25+.30*Math.sin(seconds*1.43));
    };
  }

  function fishingStall(root) {
    root.name='Рыбацкая лавка';
    for (const x of [-.32,.32]) for (const z of [-.20,.22]) {
      model(root,'box','#976b4b',[x,.31,z],[.065,.64,.063]);
    }
    model(root,'box','#be9467',[0,.235,.075],[.71,.083,.42]);
    for(let i=0;i<7;i++) {
      model(root,'box',i%2?'#e8bf87':'#a85b54',[(i-3)*.121,.605,.023],[.119,.049,.624],[.135,0,0]);
    }
    model(root,'box','#b37351',[0,.702,.26],[.40,.117,.038]);
    model(root,'round','#f3bd9a',[-.017,.70,.282],[.106,.043,.020]);
    model(root,cone,'#e6ad86',[.092,.70,.285],[.043,.093,.020],[0,0,-Math.PI/2]);
    for(const [x,z] of [[-.45,.31],[.46,.23]]) {
      model(root,'box','#a9734f',[x,.112,z],[.19,.21,.19]);
      model(root,'box','#cb9c67',[x,.221,z],[.21,.035,.21]);
    }
    const post = model(root,'stem','#bb564a',[.56,.171,-.06],[.073,.28,.071]);
    post.rotateZ(-.09);
    model(root,'round','#ce6353',[.574,.35,-.06],[.101,.08,.083]);
    for(const [x,z] of [[.10,.12],[.24,.15]]) {
      model(root,'tiny','#91aeb8',[x,.294,z],[.063,.021,.034]);
      model(root,cone,'#7a9aa4',[x-.069,.286,z],[.028,.036,.025],[0,0,-Math.PI/2]);
    }
    batchRepeatedParts(root);
    const vendor=Inhabitants.resident(root,'visitor',.86);
    vendor.base.name='Продавец рыбы';
    const tray=new Group();
    tray.name='Лоток с рыбой';
    root.add(tray);
    model(tray,'box','#b4825b',[0,0,0],[.157,.048,.104]);
    model(tray,'tiny','#bed0d2',[.032,.028,-.012],[.046,.018,.021]);
    model(tray,'tiny','#86a5b1',[-.028,.029,.023],[.046,.017,.018]);
    const supply=new Vector3(-.45,.268,.31), counter=new Vector3(-.19,.299,-.015);
    const grip=new Vector3();
    return (seconds) => {
      const t=seconds%16;
      const pick=smoothstep(t,1.65,2.5), put=smoothstep(t,6.24,7.12);
      const backAlong=smoothstep(t,12.86,14.11),backAround=smoothstep(t,14.11,15.86);
      const show=smoothstep(t,8.52,9.82)-smoothstep(t,10.22,11.67);
      const reach=.80*(smoothstep(t,1.24,2.04)-smoothstep(t,2.66,3.25))
        +.74*(smoothstep(t,5.91,6.61)-smoothstep(t,7.14,7.88));
      vendor.base.position.set(-.58 + .45*(smoothstep(t,4.1,5.83)-backAlong)+.23*show,
        .008,.12-.52*(smoothstep(t,2.78,4.09)-backAround));
      vendor.base.rotation.y=.6-Math.PI*(smoothstep(t,2.7,3.28)-smoothstep(t,5.48,6.05))
        +1.19*(smoothstep(t,4.04,4.55)-smoothstep(t,5.48,6.05))
        -1.0*(smoothstep(t,12.29,13)-smoothstep(t,15.39,15.9));
      const step=smoothstep(t,2.68,3.07)-smoothstep(t,5.57,5.99)
        +smoothstep(t,8.52,8.94)-smoothstep(t,11.38,11.75)
        +smoothstep(t,12.99,13.24)-smoothstep(t,15.43,15.92);
      vendor.pose(seconds,.77*step,.19+reach,.30*(smoothstep(t,9.60,10.03)-smoothstep(t,10.46,10.93)));
      const hold=smoothstep(t,2.01,2.55)-put;
      tray.position.copy(t<4.3?supply:counter);
      if (hold>.001) tray.position.lerp(root.worldToLocal(vendor.hands[1].localToWorld(grip.set(0,.007,.038))),hold);
      tray.rotation.y=.42*hold;
      tray.visible=pick<1 || t<13.30 || t>15.96;
    };
  }

  function sailboat(world, surface) {
    const boat=new Group();
    boat.name='Парусник в проливе';
    world.add(boat);
    model(boat,'round','#9e564b',[0,.037,0],[.139,.083,.342]);
    model(boat,'round','#e8bb85',[0,.093,.00],[.121,.025,.287]);
    model(boat,'stem','#946c50',[0,.31,-.033],[.013,.491,.013]);
    const sail=new THREE.Shape();
    sail.moveTo(.0,0); sail.quadraticCurveTo(.115,.11,.05,.38); sail.lineTo(.305,0); sail.closePath();
    const cloth=new THREE.ShapeGeometry(sail).rotateY(Math.PI/2);
    const canvas=new THREE.MeshStandardMaterial({color:'#f7d38f',side:THREE.DoubleSide,roughness:.96});
    model(boat,cloth,canvas,[.01,.165,-.039],[1,1,1]);
    const wakeMaterial=new THREE.MeshBasicMaterial({color:'#f6d9db',opacity:.48,transparent:true,depthWrite:false});
    const wake=[];
    for(const side of [-1,1]) for(let i=0;i<3;i++) {
      const mark=model(boat,'round',wakeMaterial,[side*(.094+i*.065),-.006,-.29-i*.105],[.013,.009,.10],[0,side*.27,0]);
      mark.castShadow=false;
      wake.push(mark);
    }
    function waterPoint(lon) {
      return Land.direction(lon,coast(lon)-.109).multiplyScalar(waterRadius+.025);
    }
    return (seconds) => {
      const lon=seconds*.18-.40;
      const position=waterPoint(lon);
      const tangent=waterPoint(lon+.016).sub(waterPoint(lon-.016));
      boat.visible=surface.point(lon,coast(lon)-.109).length()<waterRadius-.01;
      boat.position.copy(position);
      boat.quaternion.copy(walkingFrame(position,tangent));
      boat.rotateZ(.071*Math.sin(seconds*2.6));
      for(const [i,mark] of wake.entries()) mark.scale.z=.073+.026*Math.sin(seconds*3+i*.7);
    };
  }

  function waterfallSet(root,mini) {
    const anchorRadius=root.position.length();
    const poolY=(z) => Math.sqrt(waterRadius**2-z*z)-anchorRadius;
    const outletZ=1.00;
    const fallY=poolY(outletZ);
    for(const [x,y,z,width,height,depth] of [
      [-.62,.14,.13,.58,.38,.58],[.57,.15,.16,.54,.44,.52],
      [-.53,.47,-.21,.49,.44,.50],[.51,.55,-.23,.53,.43,.46],
      [0,.366,-.29,.72,.42,.49],[-.57,-.088,.82,.32,.25,.33],
      [.49,-.12,.94,.33,.22,.29],[-.88,.065,.53,.31,.34,.27]
    ]) {
      model(root,'pebble',x>0?'#acac8b':'#8d9d83',[x,y,z],[width,height,depth],[.27,x,-.10]);
      if (y>.07) model(root,'pebble','#88a85f',[x,y+height*.78,z-.07],[width*.79,.10,depth*.73],[0,x,.08]);
    }
    const path = new THREE.CatmullRomCurve3([
      new Vector3(0,.769,-.31), new Vector3(0,.752,.004), new Vector3(0,.656,.29),
      new Vector3(0,.23,.48), new Vector3(0,poolY(.83)+.14,.83), new Vector3(0,poolY(1.19)+.031,1.19)
    ]);
    const vertices=[],uv=[],index=[];
    const rows=mini ? 10 : 22;
    for(let i=0;i<=rows;i++) {
      const t=i/rows,p=path.getPoint(t);
      const width=.261+.045*Math.sin(t*6)+.065*smoothstep(t,.62,1);
      p.y=Math.max(p.y,poolY(p.z)+.032);
      for(let j=0;j<3;j++) {
        vertices.push(p.x+(j-1)*width,p.y-(j===1?0:.023),p.z+(j===1?0:-.03));
        uv.push(j/2,t);
      }
      if(i) {
        const a=(i-1)*3;
        index.push(a,a+1,a+3,a+1,a+4,a+3,a+1,a+2,a+4,a+2,a+5,a+4);
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.computeVertexNormals();
    const time={value:0};
    const material=new THREE.MeshStandardMaterial({color:'#58bfbd',emissive:'#3e857f',emissiveIntensity:.25,side:THREE.DoubleSide,roughness:.52});
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFalls=time;
      shader.vertexShader='varying vec2 vFalls;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvFalls = uv;');
      shader.fragmentShader='varying vec2 vFalls; uniform float uFalls;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float streak = pow(.5+.5*sin(vFalls.x*57.0+sin(vFalls.y*15.0)*.93),2.9);
        float current = .25+.75*smoothstep(-.25,.71,sin(vFalls.y*38.0-uFalls*7.8+vFalls.x*7.5));
        float foam = smoothstep(.86,1.0,vFalls.y)*.42;
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.62,.91,.86),foam+streak*current*.38);`);
    };
    const ribbon=new Mesh(geometry,material);
    ribbon.name='Поток водопада';
    root.add(ribbon);
    const foam=new Group();
    foam.position.set(0,fallY+.013,outletZ);
    root.add(foam);
    for(let i=0;i<7;i++) {
      const plume=model(foam,'round',i%2?'#d7f2ce':'#a3dfd3',[(i-3)*.078,.003+(i%3)*.029,(i%2)*.073],
        [.057,.039,.079]);
      plume.castShadow=false;
    }
    const ripples = [0,1,2].map((i) => {
      const ripple=new Mesh(new THREE.RingGeometry(.94,1,28),new THREE.MeshBasicMaterial({
        color:'#d5eee3',transparent:true,opacity:.44,depthWrite:false,side:THREE.DoubleSide
      }));
      ripple.position.set(0,fallY+.025-i*.001,outletZ);
      ripple.rotateX(-Math.PI/2);
      root.add(ripple);
      return ripple;
    });
    batchRepeatedParts(root,foam);
    return (seconds,night) => {
      time.value=seconds;
      material.emissiveIntensity=.25+night*.28;
      for(const [i,plume] of foam.children.entries()) {
        plume.scale.y=.032+.034*(.5+.5*Math.sin(seconds*6.1+i*1.7));
        plume.position.y=.017+.025*Math.sin(seconds*7.7+i*2);
      }
      for(const [i,ripple] of ripples.entries()) {
        const phase=(seconds*.62+i/3)%1;
        ripple.scale.set(.20+phase*.69,.13+phase*.51,1);
        ripple.material.opacity=(1-phase)*.54;
      }
    };
  }

  function campsite(root,surface,mini) {
    const tentShape=new THREE.Shape();
    tentShape.moveTo(-.45,0); tentShape.lineTo(0,.62); tentShape.lineTo(.45,0); tentShape.closePath();
    const tentGeo=new THREE.ExtrudeGeometry(tentShape,{depth:.71,bevelEnabled:false});
    model(root,tentGeo,'#d9a453',[-.43,.015,-.41],[1,1,1]);
    model(root,new THREE.ShapeGeometry(tentShape),'#835f4a',[-.43,.020,.302],[.65,.77,1]);
    for(const x of [-.83,-.03]) model(root,'stem','#906046',[x,.28,.301],[.028,.66,.028],[0,0,x<-.4?-.55:.55]);
    model(root,'round','#7caba5',[-.41,.064,.377],[.215,.062,.18]);
    model(root,'pebble','#ad8d5d',[-.64,.024,.72],[.18,.044,.16]);
    for (const [x,z,length,tilt] of [[.375,.63,.55,1.57],[-.73,.53,.47,1.40]]) {
      const point=root.localToWorld(new Vector3(x,0,z));
      const lon=Math.atan2(point.x,point.z),lat=Math.asin(point.y/point.length());
      const ground=surface.point(lon,lat).length();
      const y=Math.sqrt(ground**2-x*x-z*z)-root.position.length()+.086;
      model(root,'stem','#986d53',[x,y,z],[.105,length,.11],[0,0,tilt]);
    }
    for(let i=0;i<7;i++) {
      const a=i*tau/7;
      model(root,'pebble','#94917b',[.35+Math.cos(a)*.203,.047,.265+Math.sin(a)*.203],[.065,.065,.063]);
    }
    model(root,'box','#6b5241',[.35,.059,.27],[.27,.073,.058],[0,-.52,0]);
    model(root,'box','#835c43',[.35,.061,.27],[.27,.073,.058],[0,.62,0]);
    const fireMaterial=new THREE.MeshStandardMaterial({color:'#ff9b57',emissive:'#ff8d38',emissiveIntensity:.29});
    const fire = new Group();
    fire.position.set(.35,.105,.27);
    root.add(fire);
    model(fire,'round',fireMaterial,[0,.105,0],[.089,.146,.083],[0,0,.14]);
    model(fire,'round',fireMaterial,[.054,.077,.029],[.056,.099,.045],[0,0,-.34]);
    const light=new THREE.PointLight('#ff9c4e',0,2.6,2);
    light.position.set(.35,.34,.272);
    if (!mini) root.add(light);
    const sparks = mini ? null : new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1,0),
      new THREE.MeshBasicMaterial({color:'#ffd27d',transparent:true,opacity:.65,depthWrite:false}),8
    );
    const float = sparks ? new THREE.Object3D() : null;
    if (sparks) {
      sparks.frustumCulled=false;
      sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(sparks);
    }
    const animateLamp=lamp(root,.72,.013,-.13,mini);
    batchRepeatedParts(root,fire);
    return (seconds,night) => {
      fire.scale.set(1+.10*Math.sin(seconds*6.9),1+.16*Math.sin(seconds*8.1),1);
      fireMaterial.emissiveIntensity=.27+night*1.55;
      light.intensity=(.22+night*1.72)*(1+.13*Math.sin(seconds*7.2));
      animateLamp(seconds,night);
      if (sparks) {
        sparks.material.opacity=.29+night*.56;
        for(let i=0;i<8;i++) {
          const lift=(seconds*.76+i/8)%1;
          float.position.set(.35+Math.sin(i*2.4+lift*4)*.12*lift,.24+lift*.57,.27+Math.cos(i*2.4)*.13*lift);
          float.scale.setScalar(Math.sin(lift*Math.PI)*.023);
          float.updateMatrix();
          sparks.setMatrixAt(i,float.matrix);
        }
        sparks.instanceMatrix.needsUpdate=true;
      }
    };
  }

  function reeds(world,surface,mini) {
    const {positionAt,add,commit}=makeDecoration(world,surface.frameAt);
    const random=Land.rng(7040);
    const sites = [[-.72,-.47],[.55,-.36],[.39,.27],[-.38,.38]];
    for (const [lon,side] of [[1.22,1],[1.69,-1],[2.31,1],[2.58,-1],[-1.96,-1],[-2.58,1],[3.02,-1]]) {
      const {center,width} = surface.river(lon);
      sites.push([lon,center+side*(width+.05)]);
    }
    for(const [lon,lat] of sites) {
      for(let i=0;i<(mini?3:11);i++) {
        const x=lon+(random()-.5)*.15,y=lat+(random()-.5)*.078;
        if (surface.margin(x,y)<.04) continue;
        const height=.17+random()*.26;
        positionAt(x,y,.01,random()*tau);
        add('stem','#6d984f',[0,height*.5,0],[.016,height,.019],[0,0,-.095],false);
        add('tiny','#ae815a',[.017,height,.0],[.028,.060,.025],null,false);
        add('tiny','#92ab58',[-.033,height*.32,0],[.029,.095,.016],[0,0,.38],false);
      }
    }
    commit();
  }

  function fish(world,kind) {
    const xyz = kind === 'pond' ? [[.32,-.25],[-.24,-.34],[.12,-.48]] : [[.28,-.22],[.39,-.32],[-.37,-.27]];
    const geometry=new THREE.SphereGeometry(1,7,5).scale(.048,.012,.12);
    const tailGeometry=new THREE.ConeGeometry(.047,.104,3).rotateX(Math.PI/2).scale(1,.14,1).translate(0,0,-.115);
    const material=new THREE.MeshBasicMaterial({color:kind==='pond'?'#94cdbb':'#d598b0',transparent:true,opacity:.62,depthWrite:false});
    const total=xyz.length*4;
    const bodies=new THREE.InstancedMesh(geometry,material,total), tails=new THREE.InstancedMesh(tailGeometry,material,total);
    bodies.frustumCulled=tails.frustumCulled=false;
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.add(bodies,tails);
    const position=new Vector3(),size=new Vector3(1,1,1), matrix=new Matrix4(), wag=new Matrix4();
    return (seconds) => {
      for(const [i,[longitude,latitude]] of xyz.entries()) for(let j=0;j<4;j++) {
        const a=seconds*.83+i*1.71-j*.36;
        const lon=longitude+.108*Math.cos(a),lat=latitude+.058*Math.sin(a);
        position.copy(Land.direction(lon,lat)).multiplyScalar(waterRadius+.019);
        const forward=Land.direction(lon-.014*Math.sin(a),lat+.007*Math.cos(a));
        const rotation=walkingFrame(position,forward);
        matrix.compose(position,rotation,size);
        bodies.setMatrixAt(i*4+j,matrix);
        tails.setMatrixAt(i*4+j,matrix.multiply(wag.makeRotationY(.17*Math.sin(seconds*7+j))));
      }
      bodies.instanceMatrix.needsUpdate=tails.instanceMatrix.needsUpdate=true;
    };
  }

  function buildShore(world,surface,mini,main) {
    const palmMotion=palms(place(world,surface,islands.palms,.016),mini?2:3);
    pines(place(world,surface,islands.pines,.008,.35));
    const beaconMotion=beacon(place(world,surface,islands.lighthouse,.025,-.23),mini);
    const reef=place(world,surface,islands.reef,.022);
    for(const [i,[x,y,z]] of [[-.27,.042,.03],[.30,.035,.15],[.04,.044,-.28],[-.22,.047,-.36],[.29,.04,-.29]].entries()) {
      model(reef,'pebble',i%2?'#aa8c80':'#c5a783',[x,y,z],[.21+i*.016,.10+i*.045,.24],[.2,i*.5,.18]);
    }
    const animateStall=mini ? null : fishingStall(place(world,surface,village,.018,-.24));
    const animateDockLamp=lamp(main,-.91,.009,.47,mini);
    const navigate=mini ? null : sailboat(world,surface);
    const swim=mini ? null : fish(world,'shore');
    const shoreLife=ShoreLife.create(world,surface,mini);
    return (seconds,night) => {
      palmMotion(seconds);
      beaconMotion(seconds,night);
      animateDockLamp(seconds,night);
      navigate?.(seconds);
      swim?.(seconds);
      animateStall?.(seconds);
      shoreLife?.(seconds,night);
    };
  }

  function buildPond(world,surface,mini) {
    const animateFalls=waterfallSet(place(world,surface,waterfall,.027,.025),mini);
    const animateCamp=campsite(place(world,surface,camp,.048,-.24),surface,mini);
    const bank=place(world,surface,routes.pond.start,.029,.18);
    const animateBankLamp=lamp(bank,-.27,.001,.13,mini);
    reeds(world,surface,mini);
    const swim=mini ? null : fish(world,'pond');
    const insects=PondInsects.create(world,surface,mini);
    return (seconds,night) => {
      animateFalls(seconds,night);
      animateCamp(seconds,night);
      animateBankLamp(seconds,night);
      swim?.(seconds);
      insects?.(seconds,night);
    };
  }

  return {coast,shoreMargin,reserve,stops,routes,place,walkingFrame,boardwalk,lamp,buildShore,buildPond};
})();

;
const Landmarks = (() => {
  const { Group, Mesh, Vector3 } = THREE;
  const { model, makeDecoration, batchRepeatedParts } = Scenery;
  const { smoothstep, clamp, lerp } = THREE.MathUtils;
  const waterRadius = Land.radius + Land.waterLevel;
  const tau = Land.tau;
  const farm = {lon:-2.64,lat:.73};
  const grove = {lon:-2.70,lat:-.62};
  const sandbanks = [
    {lon:-.74,lat:-1.04,x:.40,y:.172},
    {lon:-.12,lat:-1.24,x:.43,y:.144},
    {lon:.51,lat:-1.075,x:.33,y:.154}
  ];
  const stops = {
    shore:[{label:'Orchard',...farm,zoom:.65},{label:'Lagoon',lon:-.08,lat:-1.09,zoom:.54}],
    pond:[{label:'Stone Grove',...grove,zoom:.63}]
  };
  const wrap = (value) => THREE.MathUtils.euclideanModulo(value+Math.PI,tau)-Math.PI;
  const distance = (spot,lon,lat) => Math.hypot(wrap(lon-spot.lon)*Math.cos(spot.lat),lat-spot.lat);

  function lagoonMargin(lon,lat) {
    let margin = -Infinity;
    for (const bank of sandbanks) {
      const x = wrap(lon-bank.lon)/bank.x;
      const y = (lat-bank.lat)/bank.y;
      const shore = bank.y*(1-Math.hypot(x,y)+.068*Math.cos(Math.atan2(y,x)*3+.9));
      margin = Math.max(margin,shore);
    }
    return margin;
  }

  function relief(kind,lon,lat) {
    const center = kind === 'shore' ? farm : grove;
    const offset = distance(center,lon,lat);
    if (kind === 'shore') return .17*Math.exp(-((offset/.29)**2));
    return .25*Math.exp(-((offset/.235)**2));
  }

  function reserve(kind,lon,lat) {
    if (kind === 'shore') return distance(farm,lon,lat)<.34 || sandbanks.some((bank) => distance(bank,lon,lat)<.14);
    return kind === 'pond' && distance(grove,lon,lat)<.30;
  }

  function shift(spot,x,z) {
    return {lon:spot.lon+x/(Land.radius*Math.cos(spot.lat)),lat:spot.lat-z/Land.radius};
  }

  function decoration(world,surface,spot) {
    const batch = makeDecoration(world,surface.frameAt);
    function at(x,z,height=0,yaw=0) {
      const point = shift(spot,x,z);
      batch.positionAt(point.lon,point.lat,height,yaw);
    }
    return {...batch,at};
  }

  function followGround(person,surface,spot,x,z,yaw) {
    const target=shift(spot,x,z);
    const {position,rotation}=surface.frameAt(target.lon,target.lat,.013);
    person.base.position.copy(position);
    person.base.quaternion.copy(rotation);
    person.base.rotateY(yaw);
  }

  function orchard(world,surface,mini) {
    const {at,add,commit}=decoration(world,surface,farm);
    const treeSites=[[-.89,-.55],[.87,-.78],[-.88,.41],[.91,.39],[-.15,-.99]];
    for (const [i,[x,z]] of treeSites.slice(0,mini?3:5).entries()) {
      at(x,z,0,i*.64);
      const height=.84+.09*Math.sin(i*1.22);
      add('stem','#a37b56',[0,height*.42,0],[.089,height*.87,.085],[0,0,.12],!mini);
      for (let j=0;j<6;j++) {
        const angle=j*tau/6+i*.64;
        const dx=Math.cos(angle)*.20,dz=Math.sin(angle)*.23;
        const color=['#85a653','#96ad53','#aaba65'][j%3];
        add('pebble',color,[dx,height+j%2*.07,dz],[.285,.286,.262],null,!mini);
        add('tiny',j%2?'#f7b04e':'#f19450', [dx*1.48,height-.18+(j%3)*.08,dz*1.48],[.077,.073,.072],null,!mini);
        if (j%2===0) add('round','#f8ad50',[dx*1.92,height+.19,dz*1.83],[.076,.074,.073],null,!mini);
      }
      add('pebble','#a3b652',[0,height+.19,0],[.258,.242,.238],null,!mini);
      add('round','#ef9844',[.16,height+.38,-.13],[.074,.073,.072],null,!mini);
    }
    const rows = [-.52,-.02,.48];
    for (const [i,x] of rows.entries()) {
      for(let j=0;j<(mini?4:7);j++) {
        const z=(j-3)*.20;
        at(x,z,.005,.06+i*.03);
        add('round',i%2?'#a87e57':'#a97a51',[0,-.011,0],[.166,.046,.148],null,false);
        if (i===0) {
          for (let k=-1;k<=1;k++) {
            const h=.19+.026*(j%3+k);
            add('stem','#b48c4f',[k*.052,h*.46,0],[.009,h,.011],[0,0,-k*.14],false);
            add('tiny','#f6d280',[k*.068,h,0],[.022,.057,.026],[0,0,-k*.13],false);
          }
        } else if(i===1) {
          add('stem','#7f924c',[0,.11,0],[.015,.23,.015],null,false);
          add('tiny','#719252',[0,.151,0],[.101,.033,.060],null,false);
          add('round','#d7664e',[-.060,.10,.02],[.047,.044,.049],null,false);
          add('round','#f67b54',[.052,.14,.02],[.045,.041,.047],null,false);
        } else {
          add('round',j%2?'#82a657':'#f1a14c',[0,.054,0],[.091,.075,.081],null,false);
          add('tiny','#648750',[.006,.116,.003],[.056,.022,.041],[0,j*.53,.17],false);
        }
      }
    }
    for (let j=0;j<8;j++) {
      at(-.70, j*.191-.76,0,.025);
      add('box','#a27652',[0,.103,0],[.039,.224,.039],[0,0,j%2*.057],!mini);
      if(j<7) add('box','#b68a5b',[0,.094,.088],[.028,.046,.186],null,!mini);
    }
    for(let i=0;i<8;i++) {
      at(.82+.10*Math.sin(i*.45),.93-i*.177,0,i*.42);
      add('pebble','#d9b789',[0,.007,0],[.133,.038,.087],null,false);
    }
    commit();
    if (mini) return;
    const entrance=Landforms.place(world,surface,shift(farm,.38,1.16),.025,-.28);
    const lamp=Landforms.lamp(entrance,0,0,0,false);
    const basket=Landforms.place(world,surface,shift(farm,-.68,1.05),.01);
    model(basket,'stem','#bf9667',[0,.041,0],[.088,.083,.089]);
    model(basket,'ring','#e1c18d',[0,.082,0],[.081,.075,.083],[Math.PI/2,0,0]);
    for(const x of [-.039,.033]) model(basket,'tiny','#efad52',[x,.077,.021],[.034,.032,.030]);
    const well=Landforms.place(world,surface,shift(farm,1.04,1.22),.006,.21);
    well.name='Колодец в апельсиновом саду';
    model(well,'stem','#679c94',[0,.035,0],[.141,.05,.141]);
    for(let i=0;i<8;i++) {
      const a=i*tau/8;
      for(const y of [.052,.129]) model(well,'pebble',i%2?'#b8aa92':'#9f937d',
        [Math.cos(a)*.158,y,Math.sin(a)*.158],[.087,.061,.08],[0,a+y*5,0]);
    }
    for(const x of [-.19,.19]) model(well,'box','#916747',[x,.25,0],[.042,.49,.041]);
    model(well,'box','#b08256',[0,.482,0],[.44,.045,.046]);
    const rope=model(well,'stem','#e0c59a',[0,.31,0],[.012,.34,.012]);
    const bucket=model(well,'stem','#b18459',[0,.18,0],[.058,.092,.058]);
    batchRepeatedParts(well);
    const gardener=Inhabitants.resident(world,'grower',.94);
    gardener.base.name='Садовник в апельсиновом саду';
    const can=new Group();
    can.name='Лейка';
    can.position.set(.017,-.045,.050);
    gardener.hands[1].add(can);
    model(can,'stem','#669b9a',[0,0,0],[.073,.094,.069]);
    model(can,'ring','#a2c0ae',[0,.051,-.017],[.038,.049,.042]);
    model(can,'stem','#74a9a5',[0,.015,.082],[.020,.12,.021],[1.03,0,0]);
    model(can,'stem','#b0c6a8',[0,.042,.139],[.032,.021,.032],[1.03,0,0]);
    const drops=new THREE.InstancedMesh(new THREE.SphereGeometry(1,6,4),
      new THREE.MeshBasicMaterial({color:'#a0e0dc'}),13);
    drops.name='Вода из лейки';
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    drops.frustumCulled=false;
    world.add(drops);
    const drop=new THREE.Object3D(), spout=new Vector3(), fillTarget=new Vector3(), lift=new Vector3();
    const lane=(row)=>rows[row]+.244;
    const path=[
      [0,.77,1.08,1.12],[1.9,.77,1.08,1.12],[2.6,.78,.82,Math.PI],
      [4.35,lane(0),.82,-Math.PI/2], [4.95,lane(0),.61,-2.57],
      [8.05,lane(0),-.60,-2.57],[8.74,lane(0),-.83,Math.PI],
      [9.67,lane(1),-.83,Math.PI/2],[10.2,lane(1),-.60,-.53],
      [13.30,lane(1),.60,-.53],[13.97,lane(1),.82,0],
      [14.91,lane(2),.82,Math.PI/2],[15.43,lane(2),.60,-2.57],
      [18.53,lane(2),-.60,-2.57],[19.24,lane(2),-.81,Math.PI],
      [19.94,1.17,-.76,1.59],[22.79,1.18,.93,.08],[23.65,.77,1.08,1.12],
      [24.2,.77,1.08,1.12]
    ];
    const watering=[[4.95,8.05],[10.2,13.3],[15.43,18.53]];
    return (seconds,night) => {
      lamp(seconds,night);
      const t=seconds%24.2;
      const i=path.findIndex(([time])=>time>t);
      const [start,x,z,yaw]=path[i-1], [end,toX,toZ,toYaw]=path[i];
      const progress=smoothstep(t,start,end);
      const currentZ=lerp(z,toZ,progress);
      const direction=THREE.MathUtils.euclideanModulo(toYaw-yaw+Math.PI,tau)-Math.PI;
      followGround(gardener,surface,farm,lerp(x,toX,progress),currentZ,yaw+direction*smoothstep(t,start,start+(end-start)*.64));
      const row=watering.findIndex(([a,b])=>t>=a && t<b);
      const tilt=row<0?0:smoothstep(progress,0,.12)*(1-smoothstep(progress,.89,1));
      const filling=smoothstep(t,0,.63)*(1-smoothstep(t,1.05,1.73));
      bucket.position.y=.155+.17*filling;
      rope.scale.y=.475-bucket.position.y;
      rope.position.y=.475-rope.scale.y*.5;
      const walk=clamp(Math.hypot(toX-x,toZ-z)/(end-start)*2,0,1)
        *smoothstep(t,start,start+.16)*(1-smoothstep(t,end-.16,end));
      gardener.pose(seconds,Math.min(walk+tilt*.22,1),.16+.53*tilt+.56*filling);
      can.rotation.x=.38*tilt+.52*filling;
      const refill=smoothstep(t,.68,.90)*(1-smoothstep(t,1.29,1.49));
      bucket.rotation.z=.60*refill;
      drops.visible=tilt>.10 || refill>.1;
      if (!drops.visible) return;
      const atWell=refill>.1;
      if(atWell) {
        world.worldToLocal(can.localToWorld(fillTarget.set(0,.045,0)));
        world.worldToLocal(bucket.localToWorld(spout.set(-.031,.045,0)));
      } else world.worldToLocal(can.localToWorld(spout.set(0,.042,.15)));
      for(let j=0;j<drops.count;j++) {
        const a=(seconds*2.65+j/drops.count)%1;
        let target=fillTarget;
        if(!atWell) {
          const end=shift(farm,rows[row],currentZ+.073*Math.sin(j*2.4));
          target=surface.point(end.lon,end.lat,.07);
        }
        drop.position.copy(spout).lerp(target,a).addScaledVector(lift.copy(target).normalize(),.062*Math.sin(a*Math.PI));
        drop.scale.set(.010,.017,.010);
        drop.updateMatrix();
        drops.setMatrixAt(j,drop.matrix);
      }
      drops.instanceMatrix.needsUpdate=true;
    };
  }

  function lagoon(world,surface,mini) {
    const cabin=Landforms.place(world,surface,sandbanks[0],.013,.24);
    cabin.name='Домик на сваях в лагуне';
    for(const x of [-.235,.235]) for(const z of [-.146,.23]) {
      model(cabin,'stem','#a77b58',[x,.13,z],[.036,.32,.038]);
    }
    model(cabin,'box','#ad805d',[0,.286,.068],[.61,.074,.59]);
    model(cabin,'box','#ebcb9d',[0,.444,-.052],[.47,.30,.346]);
    model(cabin,'box','#805b48',[.116,.379,.124],[.117,.177,.029]);
    const window=new THREE.MeshStandardMaterial({color:'#71948d',emissive:'#fbaa68',emissiveIntensity:0});
    model(cabin,'box',window,[-.109,.456,.125],[.111,.126,.028]);
    for(const direction of [-1,1]) {
      model(cabin,'box','#729383',[direction*.145,.67,-.050],[.359,.061,.50],[0,0,-direction*.61]);
      model(cabin,'box','#577b6b',[direction*.148,.643,.198],[.355,.038,.032],[0,0,-direction*.61]);
    }
    for(let j=0;j<4;j++) {
      model(cabin,'box','#bc956c',[-.11,.292-j*.063,.38+j*.075],[.20,.040,.10]);
    }
    const animateLamp=Landforms.lamp(cabin,.29,-.03,.26,mini);
    batchRepeatedParts(cabin);
    const {at,add,commit}=decoration(world,surface,sandbanks[1]);
    for(const [i,[x,z]] of [[-.22,-.17],[.09,.10],[.32,.03],[-.18,.29],[.25,-.24],[-.29,-.3]].entries()) {
      at(x,z,0,i*.47);
      add('pebble',i%2?'#d4a38d':'#b79485',[0,.031,0],[.15+i*.014,.085,.119],null,!mini);
      add('pebble','#baac78',[.112,.052,-.051],[.053,.048,.055],null,false);
    }
    commit();
    const marker=Landforms.place(world,surface,sandbanks[2],.003,.17);
    model(marker,'stem','#ae8668',[0,.184,0],[.033,.37,.035]);
    model(marker,'box','#ad6253',[0,.331,.017],[.205,.101,.032],[0,0,-.11]);
    model(marker,'pebble','#b88779',[-.16,.049,.073],[.163,.105,.127]);
    if (mini) return (seconds,night) => {
      window.emissiveIntensity=night*1.5;
      animateLamp(seconds,night);
    };

    const boat=new Group();
    boat.name='Шлюпка в южной лагуне';
    world.add(boat);
    model(boat,'round','#7e675d',[0,.027,0],[.123,.064,.232]);
    model(boat,'round','#ecc79c',[0,.067,0],[.107,.020,.192]);
    model(boat,'box','#b97e69',[0,.084,.021],[.171,.029,.088]);
    const rower=new Group();
    rower.position.set(.034,.088,.013);
    boat.add(rower);
    model(rower,'round','#edb275',[0,.105,0],[.069,.078,.057]);
    model(rower,'round','#a56f79',[0,.046,.008],[.055,.057,.049]);
    model(rower,'round','#e8bf76',[0,.164,0],[.102,.023,.085]);
    const paddle=model(rower,'stem','#8d695a',[.111,.051,-.035],[.016,.310,.016],[0,0,1.25]);
    const buoys=[[-.39,-.90],[.28,-.93]].map(([lon,lat])=>{
      const buoy=new Group();
      world.add(buoy);
      model(buoy,'round','#d9846e',[0,.038,0],[.069,.048,.070]);
      model(buoy,'stem','#e6ccb0',[0,.099,0],[.012,.134,.013]);
      return {buoy,lon,lat};
    });
    function waterPoint(angle) {
      return Land.direction(-.065+.238*Math.cos(angle),-.985+.063*Math.sin(angle)).multiplyScalar(waterRadius+.021);
    }
    return (seconds,night) => {
      animateLamp(seconds,night);
      window.emissiveIntensity=night*1.5;
      const angle=seconds*.49;
      const position=waterPoint(angle);
      boat.position.copy(position);
      boat.quaternion.copy(Landforms.walkingFrame(position,waterPoint(angle+.015).sub(waterPoint(angle-.015))));
      boat.rotateZ(.07*Math.sin(seconds*3.22));
      paddle.rotation.x=.62*Math.sin(seconds*4.5);
      for(const [i,{buoy,lon,lat}] of buoys.entries()) {
        buoy.position.copy(Land.direction(lon,lat)).multiplyScalar(waterRadius+.01+.017*Math.sin(seconds*2.78+i));
        buoy.quaternion.copy(Land.frame(lon,lat).rotation);
      }
    };
  }

  const slabGeometry = new THREE.CylinderGeometry(1,1,1,7);
  const capGeometry = new THREE.ConeGeometry(1,1,4);

  function stoneGrove(world,surface,mini) {
    const hollow=Landforms.place(world,surface,grove,.023,-.17);
    hollow.name='Каменная роща';
    for(const [x,y,z,width,height,depth,yaw] of [
      [-.64,.27,-.24,.44,.43,.46,-.5], [.59,.26,-.28,.405,.48,.45,.24],
      [-.43,.61,-.44,.36,.49,.35,-.31], [.47,.58,-.47,.38,.43,.36,.23],
      [.005,.93,-.52,.62,.22,.35,.12],[-.80,.18,.20,.28,.25,.23,.21],[.79,.18,.16,.28,.27,.24,.62]
    ]) {
      model(hollow,'pebble',x<0?'#89908c':'#9d9e8d',[x,y,z],[width,height,depth],[.13,yaw,.06]);
      if(y>.21) model(hollow,'pebble','#83a263',[x,y+height*.76,z-.035],[width*.76,.088,depth*.69],[.02,yaw,.07]);
    }
    model(hollow,'pebble','#687971',[0,.433,-.61],[.44,.40,.22]);
    model(hollow,'pebble','#afb09b',[0,.44,-.432],[.149,.238,.085],[.05,0,-.07]);
    for(const side of [-1,1]) model(hollow,capGeometry,'#a4a99a',[side*.077,.604,-.441],[.061,.135,.043],[0,.7,side*.23]);
    model(hollow,'pebble','#889a91',[0,.369,-.365],[.092,.08,.043]);
    for(let step=0;step<4;step++) {
      const z=.62-step*.178;
      model(hollow,'box',['#a5aa91','#939c87','#939984','#afb196'][step],[0,step*.056-.004,z],[1.05-step*.12,.087,.195],[0,step*.012,0]);
    }
    const fire=new Group();
    fire.position.set(-.043,.257,.009);
    hollow.add(fire);
    model(fire,slabGeometry,'#626e68',[0,-.088,0],[.196,.145,.196]);
    model(fire,slabGeometry,'#b48162',[0,.017,0],[.177,.103,.180]);
    model(fire,slabGeometry,'#5e5a55',[0,.070,0],[.161,.036,.163]);
    const flameColor=new THREE.MeshStandardMaterial({color:'#ffc06b',emissive:'#ff7948',emissiveIntensity:.55});
    const flame=model(fire,'round',flameColor,[0,.128,0],[.089,.12,.082],[0,0,-.14]);
    const light=new THREE.PointLight('#ff9f65',0,2,2);
    light.position.set(-.08,.50,.16);
    if(!mini) hollow.add(light);
    batchRepeatedParts(hollow,fire);
    const {at,add,commit}=decoration(world,surface,grove);
    for(let i=0;i<9;i++) {
      at(.23+.18*Math.cos(i*.54),.72+i*.16,0,i*1.13);
      add('pebble',i%2?'#9fa38e':'#87958d',[0,.022,0],[.180,.059,.107],null,!mini);
    }
    for(const [x,z] of [[-.82,.58],[.73,.57],[-.72,1.07],[.91,.96],[-.41,1.63]]) {
      at(x,z,0,z*.80);
      for(let i=0;i<5;i++) {
        const a=i*tau/5;
        add('tiny',i%2?'#8baa5e':'#72944e',[Math.cos(a)*.084,.094,Math.sin(a)*.09],
          [.043,.131,.027],[.5*Math.cos(a),a,-.58*Math.sin(a)],false);
      }
    }
    commit();
    if(mini) return (seconds,night) => { flameColor.emissiveIntensity=.4+night*.92; };

    const keeper=Inhabitants.resident(world,'fisher',.96);
    keeper.base.name='Хранитель каменной рощи';
    const woodpile=Landforms.place(world,surface,shift(grove,.76,1.87),.014,.31);
    woodpile.name='Поленница';
    const logShape=new THREE.CylinderGeometry(.046,.054,.24,7).rotateZ(Math.PI/2);
    for(let i=0;i<6;i++) model(woodpile,logShape,i%2?'#a77d56':'#896549',
      [i%2*.065,.049+.053*Math.floor(i/2),i%3*.070-.09],[1,1,1],[0,.18*i,0]);
    const log=model(world,logShape,'#bc875a',[0,0,0],[1,1,1]);
    log.name='Полено для жаровни';
    const logEndA=new Vector3(), logEndB=new Vector3(), grip=new Vector3();
    const sparks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),
      new THREE.MeshBasicMaterial({color:'#ffd097',transparent:true,opacity:.69,depthWrite:false}),10);
    sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    sparks.frustumCulled=false;
    fire.add(sparks);
    const point=new THREE.Object3D();
    return (seconds,night) => {
      const t=seconds%15.4;
      const walkIn=smoothstep(t,1.98,5.38),walkOut=smoothstep(t,10.43,13.83);
      const progress=walkIn-walkOut;
      const step=smoothstep(t,1.96,2.20)-smoothstep(t,5.18,5.39)
        +smoothstep(t,10.41,10.66)-smoothstep(t,13.58,13.84);
      const pickup=smoothstep(t,.18,.67)-smoothstep(t,1.15,1.71);
      const tend=smoothstep(t,5.48,6.20)-smoothstep(t,7.24,7.98);
      const kindling=smoothstep(t,6.62,7.54)*(1-smoothstep(t,8.24,10.61));
      followGround(keeper,surface,grove,lerp(.43,.38,progress),lerp(1.70,.48,progress),
        1.12+2.02*smoothstep(t,1.44,2.14)+.64*smoothstep(t,5.29,5.76)
          +2.50*smoothstep(t,9.77,10.46)+1.12*smoothstep(t,13.80,14.58));
      keeper.pose(seconds,step,.28+pickup*.64+tend*.64,0);
      const settle=smoothstep(t,6.14,6.76);
      log.visible=t<9.56;
      if(log.visible) {
        world.worldToLocal(woodpile.localToWorld(logEndA.set(.014,.212,0)));
        world.worldToLocal(fire.localToWorld(logEndB.set(.016,.094,0)));
        world.worldToLocal(keeper.hands[1].localToWorld(grip.set(0,-.017,.029)));
        log.position.copy(logEndA).lerp(grip,smoothstep(t,.78,1.43)).lerp(logEndB,settle);
        log.quaternion.copy(keeper.base.quaternion).slerp(hollow.quaternion,settle);
        log.rotateY(.38*settle);
        log.scale.setScalar(1-smoothstep(t,8.55,9.56));
      }
      const pulse=.052*Math.sin(seconds*7.3)+kindling*.118;
      flame.scale.y=.105+pulse;
      flameColor.emissiveIntensity=.34+night*.96+kindling*1.36;
      light.intensity=(night*1.14+kindling*.83)*(1+.085*Math.sin(seconds*7.6));
      sparks.visible=night>.04 || kindling>.01;
      if (!sparks.visible) return;
      for(let i=0;i<10;i++) {
        const rise=(seconds*(.68+i*.009)+i/10)%1;
        point.position.set(Math.sin(i*2.4+rise*4)*.17*rise,.153+rise*(.40+kindling*.37),Math.cos(i*2.4)*.18*rise);
        point.scale.setScalar(Math.sin(rise*Math.PI)*(.016+kindling*.012));
        point.updateMatrix();
        sparks.setMatrixAt(i,point.matrix);
      }
      sparks.instanceMatrix.needsUpdate=true;
    };
  }

  function create(world,surface,kind,mini) {
    if(kind==='pond') return stoneGrove(world,surface,mini);
    if(kind!=='shore') return null;
    const animateOrchard=orchard(world,surface,mini);
    const animateLagoon=lagoon(world,surface,mini);
    return (seconds,night) => {
      animateOrchard?.(seconds,night);
      animateLagoon(seconds,night);
    };
  }

  return {stops,lagoonMargin,relief,reserve,create};
})();

;
const ShoreLife = (() => {
  const { Group, Vector3 } = THREE;
  const { lerp, smoothstep, clamp, euclideanModulo, degToRad } = THREE.MathUtils;
  const { model, makeDecoration, batchRepeatedParts } = Scenery;
  const workSite = { lon:1.14, lat:.248 };
  const cove = { lon:1.09, lat:.217 };
  const ridge = { lon:2.51, lat:.82 };
  const ridgeStop = { label:'Ridge', ...ridge, zoom:.52 };
  const ridgeNormal = Land.direction(ridge.lon,ridge.lat);
  const axes = Land.frame(ridge.lon,ridge.lat).rotation;
  const east = new Vector3(Land.radius,0,0).applyQuaternion(axes);
  const south = new Vector3(0,0,Land.radius).applyQuaternion(axes);
  const route = [
    [0,-1.77,.91,113],[.46,-1.77,.91,113],[1.84,-1.36,.70,116],[3.70,-.72,.34,119],
    [4.28,-.72,.34,165],[6.69,-.72,.34,165],[7.26,-.72,.34,111],
    [8.77,-.24,.13,103],[10.37,.51,.03,99],[10.97,.51,.03,43],
    [13.45,.51,.03,43],[14.03,.51,.03,71],[15.94,1.10,.31,54],
    [17.57,1.42,.68,34],[18.12,1.42,.68,82],[20.52,1.42,.68,82],
    [21.03,1.42,.68,9],[22.97,1.37,1.23,-3],[24.65,.75,1.39,-76],
    [26.39,.09,1.34,-93],[27.18,.09,1.34,-5],[33.6,.09,1.34,-5],
    [34.24,.09,1.34,-96],[36.19,-.55,1.31,-94],[38.17,-1.18,1.21,-102],
    [39.88,-1.77,.91,-116],[40.51,-1.77,.91,113],[41.25,-1.77,.91,113]
  ];

  function ridgeHeight(normal) {
    if (normal.dot(ridgeNormal)<.82) return 0;
    const x=normal.dot(east), z=normal.dot(south);
    const base=.31*Math.exp(-((x/1.54)**2+((z+.22)/.99)**2));
    const west=.92*Math.exp(-(((x+.52)/.56)**2+((z+.40)/.54)**2));
    const eastPeak=.73*Math.exp(-(((x-.55)/.49)**2+((z+.47)/.64)**2));
    const shoulder=.31*Math.exp(-(((x-1.03)/.54)**2+((z-.12)/.64)**2));
    return base+west+eastPeak+shoulder;
  }

  function nearby(spot,x,z) {
    return { lon:spot.lon+x/(Land.radius*Math.cos(spot.lat)), lat:spot.lat-z/Land.radius };
  }

  function reserve(lon,lat) {
    const longitudeFrom=site=>euclideanModulo(lon-site.lon+Math.PI,Land.tau)-Math.PI;
    const central = [[cove,.23],[ridge,.33]].some(([site,radius]) => {
      const delta = longitudeFrom(site);
      return Math.hypot(delta*Math.cos(site.lat),lat-site.lat)<radius;
    });
    if (central) return true;
    const x=longitudeFrom(ridge)*Math.cos(ridge.lat)*Land.radius, z=(ridge.lat-lat)*Land.radius;
    if (Math.abs(x)>2 || z<0 || z>1.64) return false;
    return route.some(([,nextX,nextZ],i) => {
      if (i===0) return false;
      const [,feetX,feetZ]=route[i-1];
      const dx=nextX-feetX, dz=nextZ-feetZ;
      const distance=dx*dx+dz*dz;
      const step=distance>0 ? clamp(((x-feetX)*dx+(z-feetZ)*dz)/distance,0,1) : 0;
      return Math.hypot(x-feetX-step*dx,z-feetZ-step*dz)<.22;
    });
  }

  function mooring() {
    const lon=1.15;
    return {lon,lat:Landforms.coast(lon)-.144};
  }

  const window = (t,start,full,release,end) => smoothstep(t,start,full)-smoothstep(t,release,end);

  function follow(person,surface,spot,path,t) {
    const i = path.findIndex(([time]) => time>t);
    const [from,x,z,bearing] = path[i-1];
    const [to,nextX,nextZ,nextBearing] = path[i];
    const drift = smoothstep(t,from,to);
    const point = nearby(spot,lerp(x,nextX,drift),lerp(z,nextZ,drift));
    const {position,rotation} = surface.frameAt(point.lon,point.lat,.016);
    const turn = euclideanModulo(nextBearing-bearing+180,360)-180;
    person.base.position.copy(position);
    person.base.quaternion.copy(rotation);
    person.base.rotateY(degToRad(bearing+turn*drift));
    const stride = clamp(Math.hypot(nextX-x,nextZ-z)/(to-from)*3.2,0,.94);
    return stride*window(t,from,from+.18,to-.18,to);
  }

  function traveler(world,surface) {
    const signs = makeDecoration(world,surface.frameAt);
    const breadcrumbs=[
      [-1.75,.90],[-1.58,.81],[-1.36,.70],[-1.18,.60],[-1.00,.50],[-.88,.43],[-.73,.35],[-.56,.27],
      [-.38,.17],[-.16,.11],[.05,.07],[.26,.04],[.48,.03],[.67,.11],[.86,.20],[1.04,.29],
      [1.22,.45],[1.40,.66],[1.42,.86],[1.39,1.04],[1.37,1.22],[1.16,1.28],[.96,1.33],
      [.74,1.38],[.54,1.37],[.32,1.36],[.08,1.34],[-.14,1.33],[-.38,1.32],[-.60,1.30],
      [-.82,1.27],[-1.04,1.24],[-1.24,1.18],[-1.44,1.08],[-1.62,.99]
    ];
    for (const [i,[x,z]] of breadcrumbs.entries()) {
      const p=nearby(ridge,x,z);
      signs.positionAt(p.lon,p.lat,-.006,i*1.1);
      signs.add('pebble',i%2?'#c1a282':'#dac09a',[0,.019,0],[.08+i%3*.016,.031,.062+i%4*.009],null,false);
    }
    const marker = nearby(ridge,-.68,.14);
    signs.positionAt(marker.lon,marker.lat,0,-.25);
    signs.add('stem','#8f684c',[0,.162,0],[.034,.37,.037]);
    signs.add('box','#b1815a',[0,.30,.013],[.205,.095,.037],[0,0,.17]);
    signs.add('box','#e9cfa3',[.018,.301,.036],[.107,.016,.010],[0,0,.17]);
    signs.add('pebble','#e0c5a0',[-.018,.02,0],[.097,.071,.077]);
    const rest=nearby(ridge,.086,1.245);
    signs.positionAt(rest.lon,rest.lat,-.007,.14);
    signs.add('pebble','#ab8d73',[0,.037,0],[.206,.116,.117],[0,.18,-.07]);
    signs.add('pebble','#c9aa87',[-.03,.111,.006],[.175,.041,.094],[0,.16,-.035]);
    signs.add('pebble','#dcc380',[-.21,.053,-.007],[.109,.079,.104],[0,0,.20]);
    signs.commit();

    const person = Inhabitants.resident(world,'traveler',1.03);
    person.base.name='Путешественник с рюкзаком';
    const pack = new Group();
    pack.name='Рюкзак с походным пледом';
    pack.position.set(0,.333,-.104);
    person.torso.add(pack);
    model(pack,'round','#aa644d',[0,0,-.021],[.117,.143,.091]);
    model(pack,'round','#ce8559',[0,.073,-.079],[.111,.063,.037]);
    model(pack,'round','#b87452',[0,-.043,-.097],[.075,.052,.031]);
    model(pack,'stem','#e2b278',[0,.137,-.043],[.052,.255,.055],[0,0,Math.PI/2]);
    for (const x of [-.062,.062]) {
      model(pack,'box','#704f43',[x,.022,-.098],[.018,.130,.014]);
      model(pack,'tiny','#eed198',[x,.012,-.105],[.018,.019,.009]);
    }
    batchRepeatedParts(pack);

    const map = new Group();
    map.name='Развернутая карта';
    map.position.set(-.062,.01,.049);
    person.hands[1].add(map);
    model(map,'box','#f5e5b4',[0,0,0],[.149,.013,.105]);
    model(map,'box','#84abad',[.013,.008,-.006],[.093,.007,.067],[0,.22,0]);
    model(map,'pebble','#cfab67',[.016,.015,.002],[.034,.008,.023]);
    model(map,'tiny','#b86956',[.027,.024,.012],[.010,.009,.009]);
    const fold = new Group();
    fold.position.x=-.073;
    map.add(fold);
    model(fold,'box','#e5cf9a',[-.035,0,0],[.072,.011,.105]);

    const glass = new Group();
    glass.name='Подзорная труба';
    glass.position.set(-.021,.007,.041);
    person.hands[1].add(glass);
    model(glass,'stem','#9e7756',[0,0,.051],[.027,.129,.026],[Math.PI/2,0,0]);
    model(glass,'stem','#d8ac69',[0,0,.116],[.032,.034,.033],[Math.PI/2,0,0]);
    model(glass,'stem','#466f74',[0,0,.135],[.024,.011,.024],[Math.PI/2,0,0]);

    const gesture = {};
    return (seconds) => {
      const t=seconds%route[route.length-1][0];
      const walk=follow(person,surface,ridge,route,t);
      const reading=window(t,4.12,4.71,6.08,6.79);
      const sitting=window(t,27.18,28.02,32.82,33.6);
      const looking=Math.max(window(t,10.67,11.41,12.65,13.37),window(t,17.86,18.41,19.9,20.49),
        window(t,28.96,29.53,31.13,31.82));
      const scan=Math.sin(t*1.56)*looking;
      gesture.seated=sitting;
      gesture.leftReach=.88*reading+.27*looking+.18*sitting;
      gesture.leftRoll=-.27*reading;
      gesture.rightRoll=.21*reading+.34*looking;
      gesture.lookDown=.50*reading-.11*looking;
      gesture.lookAside=.17*scan;
      person.pose(seconds,walk,.10+1.14*reading+2.05*looking,0,gesture);
      map.visible=reading>.13;
      map.rotation.set(-.52-.55*reading,.12,.12);
      fold.rotation.z=(1-reading)*2.78;
      glass.visible=looking>.22;
      glass.rotation.set(1.29*looking,.12*scan,0);
      person.base.rotateY(scan*.22);
    };
  }

  function repairStand(world,surface) {
    const root = Landforms.place(world,surface,workSite,.025);
    root.name='Мастер в бухте';
    for (const x of [-.30,.33]) {
      for (const z of [-.17,.08]) model(root,'box','#8f674e',[x,.117,z],[.072,.27,.075]);
      model(root,'box','#a98463',[x,.177,-.033],[.044,.054,.31]);
    }
    for (const [i,z] of [-.19,-.07,.05,.145].entries()) {
      model(root,'box',i%2?'#b6885c':'#c39465',[.014,.268,z],[.76,.061,.116]);
    }
    model(root,'box','#8b624c',[0,.16,-.07],[.66,.057,.052]);
    for(const x of [-.24,.23]) model(root,'box','#8b6954',[x,.313,.078],[.066,.050,.155]);
    for(const side of [-1,1]) {
      model(root,'box','#956a4e',[-.59+side*.105,.099,.11],[.048,.21,.061]);
      model(root,'box','#b88b61',[-.59+side*.093,.19,.11],[.081,.035,.185]);
      model(root,'box','#9b7456',[.60+side*.151,.106,-.20],[.046,.225,.621]);
      model(root,'box','#af805b',[.60,.118,-.20+side*.293],[.311,.212,.044]);
    }
    model(root,'box','#ae7e58',[-.59,.12,.11],[.244,.046,.089]);
    model(root,'box','#956d55',[.60,.035,-.20],[.33,.055,.62]);
    const lid=new Group();
    lid.position.set(.757,.224,-.20);
    root.add(lid);
    model(lid,'box','#a57657',[-.157,.008,0],[.344,.046,.629]);
    model(lid,'box','#725b4d',[-.300,.045,0],[.044,.023,.138]);
    const hearth = new Group();
    hearth.scale.setScalar(.52);
    hearth.position.set(.33,.293,-.15);
    root.add(hearth);
    const light = Landforms.lamp(hearth,0,0,0,true);
    batchRepeatedParts(root,lid);

    const route = [
      [0,-.60,.41,180],[1.54,-.60,.41,180],[2.14,-.60,.41,97],
      [3.54,.04,.35,97],[4.12,.04,.35,180],[10.42,.04,.35,180],
      [11.13,.04,.35,86],[12.55,.60,.34,86],[13.08,.64,.28,175],
      [14.06,.61,.255,180],[15.98,.61,.255,180],[16.63,.61,.255,0],
      [17.58,.61,.48,0],[18.16,.61,.48,-95],[20.31,-.60,.48,-95],
      [20.86,-.60,.41,180],[21.65,-.60,.41,180]
    ];
    const person = Inhabitants.resident(world,'maker',1.01);
    person.base.name='Мастер чинит весло';
    const mallet = new Group();
    mallet.name='Деревянный молоток';
    mallet.rotation.x=.26;
    person.hands[1].add(mallet);
    model(mallet,'stem','#976b47',[0,.012,.051],[.020,.146,.018],[Math.PI/2,0,0]);
    model(mallet,'box','#684e43',[0,.013,.116],[.112,.058,.067],[0,.12,0]);
    const oar = new Group();
    oar.name='Весло в ремонте';
    root.add(oar);
    model(oar,'stem','#b78858',[-.065,0,0],[.019,.40,.018],[0,0,Math.PI/2]);
    const blade=model(oar,'pebble','#d6a476',[.156,0,0],[.133,.021,.058]);
    model(oar,'box','#a17050',[-.245,.006,0],[.074,.031,.039],[0,0,0]);
    const shavings=[];
    for(let i=0;i<4;i++) {
      shavings.push(model(root,'tiny',i%2?'#e5b981':'#f3d2a0',[0,0,0],[.019,.010,.013]));
    }

    const supply=new Vector3(-.59,.226,.11);
    const tabletop=new Vector3(.014,.351,.111);
    const rack=new Vector3(.60,.145,-.20);
    const grip=new Vector3();
    const gesture={};
    const taps=[6.32,7.06,7.65,8.41];
    return (seconds,night) => {
      light(seconds,night);
      const t=seconds%21.65;
      const walk=follow(person,surface,workSite,route,t);
      const take=window(t,.2,.68,1.18,1.59);
      const firstCarry=window(t,.89,1.52,4.35,4.98);
      const place=window(t,4.05,4.63,5.17,5.53);
      const brace=window(t,5.09,5.60,9.39,9.96);
      const tool=window(t,5.39,5.77,9.07,9.45);
      const inspect=window(t,8.50,9.03,9.47,9.87);
      const secondCarry=window(t,9.92,10.55,14.79,15.43);
      const shelve=window(t,14.12,14.68,15.42,15.86);
      lid.rotation.z=-1.32*window(t,13.76,14.49,15.43,15.91);
      let strike=0;
      let impact=-1;
      for (const tap of taps) {
        strike+=window(t,tap-.32,tap-.18,tap-.11,tap+.02);
        if (t>=tap && t<tap+.38) impact=(t-tap)/.38;
      }
      gesture.leftReach=.23*firstCarry+1.10*brace+.27*secondCarry;
      gesture.leftRoll=-.27*brace;
      gesture.rightRoll=.15*tool;
      gesture.crouch=.045*(take+shelve);
      gesture.lean=.22*take+.21*shelve+.12*brace;
      gesture.lookDown=.39*Math.max(take,place,brace,shelve)+.19*inspect;
      gesture.lookAside=.16*inspect;
      person.pose(seconds,walk,.16+.85*(take+place+shelve)+.71*tool+strike*1.11+.47*(firstCarry+secondCarry),0,gesture);
      mallet.visible=tool>.14;

      const carry=Math.max(firstCarry,secondCarry);
      oar.position.copy(t<1.7?supply:t<10.66?tabletop:rack);
      if (carry>0) oar.position.lerp(root.worldToLocal(person.hands[1].localToWorld(grip.set(.003,-.018,.025))),carry);
      oar.rotation.set(.08*carry,lerp(t<10.66?.06:Math.PI/2,1.60,carry),.35*carry);
      blade.position.x=.156+.024*(1-smoothstep(t,taps[0],taps[2]));
      for (const [i,chip] of shavings.entries()) {
        chip.visible=impact>=0;
        if (chip.visible) {
          chip.position.set(.08+(i-1.5)*impact*.080,.36+.093*Math.sin(impact*Math.PI),.108+i*.016+impact*.09);
          chip.rotation.y=impact*5+i;
          chip.scale.setScalar(.016*(1-impact*.77));
        }
      }
    };
  }

  function landscape(world,surface,mini) {
    const {positionAt,add,commit}=makeDecoration(world,surface.frameAt);
    for (const [x,z,w,h,d,yaw] of [
      [-1.47,.30,.37,.51,.29,.2],[-1.19,.30,.23,.27,.17,.8],[-1.09,-.28,.39,.30,.29,1.2],
      [-.32,.45,.22,.33,.17,.7],[-.16,.45,.18,.23,.13,.1],[.86,-.21,.29,.39,.27,1.7],
      [1.38,.14,.22,.31,.22,.7],[.17,-.85,.27,.35,.26,1.1],[.93,-.89,.37,.34,.29,.7],
      [-.48,-.49,.27,.31,.31,1.8],[.46,-.66,.31,.26,.34,.2]
    ]) {
      const p=nearby(ridge,x,z);
      positionAt(p.lon,p.lat,-.045,yaw);
      add('pebble','#b39578',[0,h*.28,0],[w,h,d],[.17,0,-.27],!mini);
      add('pebble','#d9b78b',[-w*.35,h*.48,d*.19],[w*.65,h*.57,d*.62],[0,.28,.12],!mini);
      add('pebble','#dacb81',[-w*.18,h*.75,-d*.09],[w*.56,h*.39,d*.53],[.10,0,-.29],false);
    }

    const plants = [
      [-1.63,.43,.66],[-1.47,.12,.82],[-.95,-.15,.74],[-.63,-.94,.73],[-.13,-.94,.62],
      [.80,-.58,.69],[1.14,-.32,.87],[.89,.57,.73],[.52,.91,.76],[-.76,1.01,.72]
    ];
    const treeColors=['#bc934f','#e0b456','#e4c271','#c2954d'];
    for (const [i,[x,z,size]] of plants.entries()) {
      const p=nearby(ridge,x,z);
      positionAt(p.lon,p.lat,-.045,i*.72,size);
      add('stem','#8d6751',[0,.38,0],[.088,.83,.082],[0,0,-.13],!mini);
      for(let k=0;k<4;k++) {
        const a=k*2.399;
        add('pebble',treeColors[(i+k)%treeColors.length],[.17*Math.cos(a),.67+k*.22,.14*Math.sin(a)],
          [.24-k*.030,.39-k*.036,.22-k*.026],[.17,a,-.24],!mini);
      }
    }
    if (!mini) {
      const random=Land.rng(607862);
      const headlands=[[-2.49,.16],[-1.94,.20],[-.93,.17],[-.37,.19],[.43,.13],[.64,.19],[1.66,.16],[2.12,.16],[2.36,.14],[2.62,.20]];
      for(const [i,[lon,offset]] of headlands.entries()) {
        const lat=Landforms.coast(lon)+offset;
        positionAt(lon,lat,-.04,i*1.89,.85+random()*.37);
        add('pebble','#b99e78',[-.12,.105,.04],[.25,.19,.23],[.12,0,.17]);
        add('pebble','#cbaa85',[.15,.042,.17],[.116,.127,.142],[0,.8,0]);
        for (let j=0;j<4;j++) {
          const a=j*2.399;
          add('pebble',j%2?'#bca65b':'#cbbb70',[.16+.15*Math.cos(a),.09+.025*j,-.10+.15*Math.sin(a)],
            [.141,.133,.142],[.17,a,-.11],j%2===0);
        }
      }
      const groves=[
        ...[[-1.25,.23],[-.91,.02],[-.44,.48],[.71,.35],[.07,-.28],[.72,-.54],[-.89,.99],[.19,.93],
          [1.64,.73],[1.57,1.29],[.63,1.65],[-1.42,1.43]].map(([x,z])=>nearby(ridge,x,z)),
        ...[-2.81,-2.30,-1.75,-1.19,-.82,-.32,.20,.47,.71,.82,1.37,1.64,1.91,2.47,2.81].map((lon,index)=>({lon,lat:Landforms.coast(lon)+.083+(index%3)*.061}))
      ];
      for (const [i,patch] of groves.entries()) {
        for(let j=0;j<11;j++) {
          const x=(random()-.5)*.53,z=(random()-.5)*.52;
          const p=nearby(patch,x,z);
          if (surface.margin(p.lon,p.lat)<.052) continue;
          positionAt(p.lon,p.lat,-.009,random()*Land.tau,.71+random()*.53);
          for (let blade=-1;blade<=1;blade++) {
            const height=.063+random()*.105;
            add('tiny',blade ? '#a8a05d' : '#c3af69',[blade*.033,height*.62,.021*blade],
              [.017,height,.014],[0,0,-.40*blade],false);
          }
          if(j%4===0) {
            add('pebble',i%3?'#b5a662':'#be9e78',[.042,.065,.025],[.152,.111,.133],[0,.3,-.12],false);
            add('pebble','#d6bf63',[-.043,.105,-.026],[.088,.096,.104],[.11,0,0],false);
          }
          if(j%3===1) {
            const h=.12+random()*.15;
            add('stem','#7b8c54',[.02,h*.5,.02],[.010,h,.011],null,false);
            for(let k=0;k<4;k++) {
              const a=k*Land.tau/4;
              add('tiny',i%3?'#e9d8a4':'#aa81b4',[.02+.029*Math.cos(a),h,.02+.029*Math.sin(a)],
                [.026,.016,.022],[0,-a,0],false);
            }
            add('tiny','#f1bd6b',[.02,h+.012,.02],[.017,.016,.017],null,false);
          }
        }
      }
    }
    commit();
  }

  function create(world,surface,mini) {
    landscape(world,surface,mini);
    const startLon=.99, endLon=1.00;
    Landforms.boardwalk(world,surface,{
      start:{lon:startLon,lat:Landforms.coast(startLon)+.105},
      end:{lon:endLon,lat:Landforms.coast(endLon)-.172}
    });
    if (mini) return;
    const travel = traveler(world,surface);
    const repair = repairStand(world,surface);
    return (seconds,night) => {
      travel(seconds+1.5);
      repair(seconds,night);
    };
  }

  return {cove,ridgeStop,ridgeHeight,reserve,mooring,create};
})();

;
const CloverWallow = (()=>{
  const {Color, Group, Mesh, Vector3}=THREE;
  const {clamp, lerp, smoothstep, euclideanModulo}=THREE.MathUtils;
  const {model, makeDecoration, batchRepeatedParts}=Scenery;
  const site={lon:-1.79,lat:-.56};
  const cycle=27.6;
  const offsets=[4.9,14.1,23.3];
  const journeys=[
    [[-.86,-.20],[-.26,-.09],[-.72,.48],[-.91,.14]],
    [[.82,-.21],[.31,-.10],[.75,.38],[.97,.10]],
    [[.49,.73],[.055,.224],[-.17,.64],[.20,.88]]
  ];

  function at(x,z) {
    return {lon:site.lon+x/(Land.radius*Math.cos(site.lat)),lat:site.lat-z/Land.radius};
  }

  function shapeMud(world,surface) {
    const verts=[],normColors=[],faces=[];
    const clay=new Color('#745347'),mud=new Color('#87624c'),sand=new Color('#a4815d');
    const n=32,rings=6;
    const center=surface.point(site.lon,site.lat,.011);
    verts.push(center.x,center.y,center.z);
    normColors.push(clay.r,clay.g,clay.b);
    for(let layer=1;layer<=rings;layer++) {
      const r=layer/rings;
      for(let i=0;i<n;i++) {
        const a=i*Land.tau/n;
        const edge=1+.058*Math.cos(a*3+.6)+.045*Math.sin(a*5-.9);
        const spot=at(.71*r*edge*Math.cos(a),.48*r*edge*Math.sin(a));
        const point=surface.point(spot.lon,spot.lat,.012+.009*(1-r));
        verts.push(point.x,point.y,point.z);
        const tint=clay.clone().lerp(mud,clamp(r*.51+.34+.17*Math.sin(a*4-r*11),0,1));
        tint.lerp(sand,smoothstep(r,.76,1));
        normColors.push(tint.r,tint.g,tint.b);
        const index=1+(layer-1)*n+i,next=1+(layer-1)*n+(i+1)%n;
        if(layer===1) faces.push(0,next,index);
        else faces.push(index-n,next-n,index,next-n,next,index);
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setIndex(faces);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(normColors,3));
    geometry.computeVertexNormals();
    const patch=new Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.57,side:THREE.DoubleSide}));
    patch.name='Грязевая лужа';
    patch.receiveShadow=true;
    world.add(patch);
  }

  function grove(world,surface,mini) {
    shapeMud(world,surface);
    const batch=makeDecoration(world,surface.frameAt);
    const places=[[-1.07,-.28,.83],[-.87,-.55,1.14],[-.41,-.64,.99],[.16,-.67,.85],[.85,-.50,.91],
      [1.08,-.21,1.10],[1.15,.31,.83],[.85,.53,.85],[.48,.85,.77],[.09,.86,.69],[-.56,.73,.96],[-.99,.51,.90]];
    for(const [i,[x,z,s]] of places.entries()) {
      const spot=at(x,z);
      batch.positionAt(spot.lon,spot.lat,-.015,i*1.87,s);
      if(i%3!==1) batch.add('pebble',i%2?'#a89176':'#9c9d83',[-.08,.05,.04],[.197,.117,.116],[.3,.6,.19],!mini);
      for(let j=0;j<5;j++) {
        const a=j*2.399,height=.089+.043*((i+j)%4);
        batch.add('tiny',j%2?'#779660':'#aab575',[.085*Math.cos(a),height*.53,.079*Math.sin(a)],
          [.019,height,.017],[.27*Math.cos(a),a,-.40*Math.sin(a)],false);
      }
      if(i%4===1 || i%4===3) {
        batch.add('stem','#ded1b4',[.11,.058,.07],[.026,.12,.025],[0,0,.19],false);
        batch.add('tiny',i%4===1?'#b97962':'#c79875',[.105,.119,.07],[.083,.047,.069],[.14,0,.23],false);
      }
    }
    const log=at(-.94,-.50);
    batch.positionAt(log.lon,log.lat,.012,2.45);
    batch.add('stem','#8b735c',[0,.052,0],[.088,.64,.083],[Math.PI/2,0,0],!mini);
    batch.add('stem','#c2a885',[0,.054,.322],[.070,.020,.070],[Math.PI/2,0,0],false);
    batch.add('pebble','#8fab75',[-.04,.113,-.07],[.114,.067,.209],[0,.12,.12],false);
    for(let i=0;i<12;i++) {
      const spot=at(.56-(i%3)*.075,.33+i*.036);
      batch.positionAt(spot.lon,spot.lat,.009,-.38);
      for(const side of [-1,1]) batch.add('tiny','#957357',[side*.012,.006,0],[.010,.006,.017],null,false);
    }
    batch.commit();
    const lamp=Landforms.place(world,surface,at(-.61,.71),-.015,-.4);
    lamp.scale.setScalar(.69);
    return Landforms.lamp(lamp,0,0,0,true);
  }

  const curledTail=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new Vector3(0,0,0),new Vector3(0,.047,-.055),new Vector3(.035,.106,-.062),new Vector3(.083,.102,-.067),
    new Vector3(.099,.053,-.070),new Vector3(.055,.036,-.075),new Vector3(.039,.072,-.077)
  ]),14,.011,5,false);
  const triangularEar=new THREE.ConeGeometry(1,1,3);

  function pig(world,size,color,mark) {
    const base=new Group();
    base.scale.setScalar(size);
    world.add(base);
    const belly=new Group();
    base.add(belly);
    model(belly,'round',color,[0,.014,-.033],[.170,.131,.232]);
    model(belly,'pebble',mark,[.145,.031,-.063],[.027,.081,.126],[0,.10,.04]);
    model(belly,'round','#e4a589',[0,-.060,.065],[.128,.066,.143]);
    const legs=[];
    for(const x of [-.102,.102]) for(const z of [-.138,.116]) {
      const leg=new Group();
      leg.position.set(x,-.055,z);
      belly.add(leg);
      legs.push(leg);
      model(leg,'stem',color,[0,-.042,0],[.039,.105,.042]);
      model(leg,'round','#905c59',[0,-.098,.012],[.037,.029,.041]);
    }
    const head=new Group();
    head.name='Пятачок и морда';
    head.position.set(0,.046,.123);
    belly.add(head);
    model(head,'round',color,[0,.005,.059],[.119,.099,.131]);
    model(head,'round','#e3a388',[0,-.035,.167],[.085,.057,.062]);
    model(head,'round','#d68e83',[0,-.034,.200],[.067,.046,.022]);
    for(const side of [-1,1]) {
      model(head,'tiny','#8d5f5b',[side*.025,-.030,.218],[.015,.018,.009],[0,0,side*.24]);
      model(head,'tiny','#433e39',[side*.072,.038,.136],[.016,.017,.012],[0,side*.27,0]);
      model(head,'tiny','#ffefc9',[side*.072-.006,.044,.147],[.005,.006,.003]);
      model(head,triangularEar,color,[side*.072,.106,.025],[.053,.147,.052],[.23,side*.60,-side*.37]);
      model(head,triangularEar,'#cc8277',[side*.087,.108,.061],[.032,.091,.021],[.23,side*.53,-side*.40]);
    }
    const tail=model(belly,curledTail,color,[0,.044,-.217],[1,1,1]);
    const stained=[
      model(belly,'pebble','#9c6e56',[-.161,-.021,-.05],[.018,.055,.121]),
      model(belly,'pebble','#9d6a53',[.146,-.049,.054],[.018,.050,.094])
    ];
    for(const part of [head,...head.children,tail,...stained]) part.castShadow=false;
    batchRepeatedParts(head);
    function pose(seconds,walk,forage,wallow,wet,side) {
      const step=Math.sin(seconds*11.5)*walk;
      const shift=Math.sin(seconds*3.45);
      belly.position.y=.176+.021*Math.abs(step)-.061*wallow;
      belly.rotation.set(.045*step,0,side*(1.48+.36*shift)*wallow);
      head.rotation.x=.67*forage+.14*Math.sin(seconds*9.8)*forage+.21*shift*wallow;
      head.rotation.y=.16*Math.sin(seconds*5.9)*(forage+wallow);
      for(const [i,leg] of legs.entries()) leg.rotation.x=step*(i===0||i===3?.61:-.61)
        +wallow*(.43*Math.sin(seconds*10+i*.86)+.35);
      tail.rotation.y=.32*Math.sin(seconds*(walk>0?9:5));
      tail.rotation.z=.26*shift;
      for(const spot of stained) spot.visible=wet>.15;
    }
    return {base,pose};
  }

  function create(world,surface,mini) {
    const lamp=grove(world,surface,mini);
    const bearing=(from,to)=>Math.atan2(to[0]-from[0],to[1]-from[1]);
    const pigs=(mini?[[.73,'#e7ad8e','#cf977f']]:[[1.08,'#dca084','#c88672'],[.69,'#edb79b','#dba88d'],
      [.60,'#ddb293','#ba8a74']]).map(([size,color,mark],i)=>{
      const animal=pig(world,size,color,mark);
      animal.base.name=i===0?'Свинка':`Поросенок ${i}`;
      const [food,mud,rest,back]=journeys[i];
      const goIn=bearing(food,mud), goOut=bearing(mud,rest), finish=bearing(back,food);
      const bathe=[1.26,-1.12,.08][i];
      return {...animal,stations:[
        [0,food,finish],[1.87,food,finish],[2.8,food,goIn],[6.97,mud,goIn],[7.59,mud,bathe],
        [13.24,mud,bathe],[14.2,mud,goOut],[17.9,rest,goOut],[19.89,rest,goOut],
        [20.5,rest,bearing(rest,back)],[23.97,back,bearing(rest,back)],[24.4,back,finish],[cycle,food,finish]
      ]};
    });

    function animate(seconds,night) {
      lamp(seconds,night);
      for(const [i,animal] of pigs.entries()) {
        const t=mini?10:euclideanModulo(seconds+offsets[i],cycle);
        const {stations}=animal;
        const k=stations.findIndex(([time])=>time>t);
        const [start,from,heading]=stations[k-1],[end,to,arrival]=stations[k];
        const step=smoothstep(t,start,end);
        const spot=at(lerp(from[0],to[0],step),lerp(from[1],to[1],step));
        const {position,rotation}=surface.frameAt(spot.lon,spot.lat,.014);
        const turn=euclideanModulo(arrival-heading+Math.PI,Land.tau)-Math.PI;
        const walk=Math.min(1,Math.hypot(to[0]-from[0],to[1]-from[1])/(end-start)*4.8)*Math.sin(step*Math.PI)**.35;
        const forage=(1-smoothstep(t,2.18,2.88))+.66*(smoothstep(t,18,18.6)-smoothstep(t,20.2,20.6));
        const rolling=smoothstep(t,7.62,8.47)-smoothstep(t,13.14,14.14);
        const wet=smoothstep(t,8.1,9.4)-smoothstep(t,24.7,cycle);
        animal.base.position.copy(position);
        animal.base.quaternion.copy(rotation);
        animal.base.rotateY(heading+turn*step+.18*Math.sin(t*2)*rolling);
        animal.pose(seconds+i*.38,walk,forage,rolling,wet,i===1?-1:1);
        if(!mini) splash(i,t,position,rotation,rolling);
      }
      if(!mini) dirtyDrops.instanceMatrix.needsUpdate=true;
    }

    const perPig=5;
    const dirtyDrops=mini?null:new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),
      new THREE.MeshStandardMaterial({color:'#a47a58',roughness:.66}),pigs.length*perPig);
    const mark=new THREE.Object3D(),delta=new Vector3();
    const rings=[];
    if(dirtyDrops) {
      dirtyDrops.name='Брызги грязи';
      dirtyDrops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dirtyDrops.frustumCulled=false;
      world.add(dirtyDrops);
      const geometry=new THREE.RingGeometry(.93,1,22).rotateX(-Math.PI/2);
      for(const animal of pigs) {
        const ring=new Mesh(geometry,new THREE.MeshBasicMaterial({color:'#c39b73',transparent:true,opacity:0,depthWrite:false}));
        ring.visible=false;
        world.add(ring);
        rings.push(ring);
      }
    }
    function splash(i,t,position,rotation,rolling) {
      const ring=rings[i];
      ring.visible=rolling>.22;
      if(ring.visible) {
        const time=euclideanModulo(t*1.11+.26*i,1);
        ring.position.copy(position).add(delta.set(0,.025,0).applyQuaternion(rotation));
        ring.quaternion.copy(rotation);
        const swell=.11+.19*time;
        ring.scale.set(swell,1,swell*.74);
        ring.material.opacity=Math.sin(Math.PI*time)*rolling*.55;
      }
      for(let j=0;j<perPig;j++) {
        const phase=euclideanModulo(t*1.24+j/perPig+.08*i,1);
        const a=Land.tau*j/perPig+i*.93;
        const distance=.12+phase*.195;
        const peak=Math.sin(Math.PI*phase);
        delta.set(Math.cos(a)*distance,.043+peak*(.090+j*.011),Math.sin(a)*distance).applyQuaternion(rotation);
        mark.position.copy(position).add(delta);
        mark.scale.setScalar(.028*rolling*peak);
        mark.updateMatrix();
        dirtyDrops.setMatrixAt(i*perPig+j,mark.matrix);
      }
    }

    animate(0,0);
    return mini?lamp:animate;
  }

  return {site,create};
})();

;
const CloverHay=(()=>{
  const {Group,Vector3}=THREE;
  const {clamp,lerp,smoothstep,euclideanModulo,degToRad}=THREE.MathUtils;
  const {model,makeDecoration,batchRepeatedParts}=Scenery;
  const site={lon:2.77,lat:.91};
  const rows=[-.64,-.27,.10];
  const cycle=31.8;
  const pass=[[3.78,6.63],[8.11,10.96],[12.37,15.22]];
  const route=[
    [0,-.89,.91,-170],[1.70,-.92,.66,-169],[3.12,-.84,.54,167],
    [3.78,-.84,.54,162],[6.63,-.84,-.49,162],[7.24,-.82,-.695,90],
    [7.78,-.45,-.69,36],[8.11,-.43,-.49,36],[10.96,-.43,.54,36],
    [11.51,-.41,.73,90],[12.07,-.06,.71,156],[12.37,-.06,.54,161],
    [15.22,-.06,-.49,161],[16.07,.13,-.60,100],[18.10,.13,-.60,123],
    [19.78,.52,-.18,53],[21.24,.61,.47,8],[22.05,.96,.52,93],
    [22.83,1.01,.38,180],[25.26,1.01,.38,180],[26.02,.93,.62,-30],
    [27.38,.71,.86,-38],[29.60,-.62,.91,-89],[30.76,-.89,.91,-171],[cycle,-.89,.91,-170]
  ];

  function at(x,z) {
    return {lon:site.lon+x/(Land.radius*Math.cos(site.lat)),lat:site.lat-z/Land.radius};
  }

  function reserve(lon,lat,scale=1) {
    const dx=euclideanModulo(lon-site.lon+Math.PI,Land.tau)-Math.PI;
    const x=dx*Land.radius*Math.cos(site.lat), z=(site.lat-lat)*Land.radius;
    return Math.hypot(x/(1.64*scale),z/(1.15*scale))<1;
  }

  const golden=['#bd9f60','#ddbd77','#cfa567','#e3c685'];
  function field(world,surface,mini) {
    const rng=Land.rng(649211);
    const meadow=makeDecoration(world,surface.frameAt);
    const plants=[];
    for(const [row,x] of rows.entries()) {
      const count=mini?9:21;
      for(let i=0;i<count;i++) {
        const z=-.53+1.10*i/(count-1);
        const p=at(x+(rng()-.5)*.142,z+(rng()-.5)*.059);
        const {position,rotation}=surface.frameAt(p.lon,p.lat,.004);
        for(let blade=0;blade<4;blade++) plants.push({position,rotation,row,z,height:.116+rng()*.134,
          dx:(blade-1.5)*.038,dz:(rng()-.5)*.084,lean:(rng()-.5)*.59,tone:golden[(i+row+blade)%4]});
      }
    }
    for(const [i,[x,z]] of [[-1.28,.53],[-1.16,-.52],[-.92,-.87],[-.46,-.90],[.06,-.86],[.59,-.77],
      [1.21,-.68],[1.52,-.22],[1.42,.37],[1.18,.81],[.56,1.03],[-.21,1.08],[-.73,1.14],
      [-1.34,1.03],[-1.43,-.96],[-.93,-1.06],[-.37,-1.15],[.28,-1.16],[.78,-1.08],[1.48,-.92],[-1.47,.12]].entries()) {
      const p=at(x,z);
      meadow.positionAt(p.lon,p.lat,-.010,i*.71,.79+rng()*.39);
      meadow.add('pebble',i%2?'#a4a18a':'#919c84',[-.04,.053,.02],[.158,.111,.137],[.20,.17,.04],!mini);
      for(let j=0;j<6;j++) {
        const a=j*2.39,h=.095+rng()*.14;
        meadow.add('tiny',j%3?'#9baa62':'#b8b474',[.131*Math.cos(a),h*.53,.123*Math.sin(a)],
          [.021,h,.018],[.34*Math.cos(a),a,-.29*Math.sin(a)],false);
      }
      if(i%3===0) meadow.add('tiny','#c6a8ba',[.123,.166,.018],[.035,.053,.033],null,false);
    }
    meadow.commit();
    const stalks=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,3),new THREE.MeshStandardMaterial({roughness:1}),plants.length);
    stalks.name='Трава на сенокосе';
    world.add(stalks);
    const transform=new THREE.Object3D(),shift=new Vector3();
    for(const [i,{tone}] of plants.entries()) stalks.setColorAt(i,new THREE.Color(tone));
    if(!mini) stalks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    function cut(t) {
      const grow=smoothstep(t,28,cycle);
      for(const [i,{position,rotation,row,z,height,dx,dz,lean}] of plants.entries()) {
        const [start,end]=pass[row];
        const order=clamp((z+.53)/1.1,0,1);
        const cutAt=lerp(start,end,row===1?order:1-order);
        const short=smoothstep(t,cutAt-.12,cutAt+.19)*(1-grow);
        const h=lerp(height,.031,short);
        transform.position.copy(position).add(shift.set(dx,h*.48,dz).applyQuaternion(rotation));
        transform.quaternion.copy(rotation);
        transform.rotateZ(lean+short*.34);
        transform.scale.set(.026,h,.021);
        transform.updateMatrix();
        stalks.setMatrixAt(i,transform.matrix);
      }
      stalks.instanceMatrix.needsUpdate=true;
    }
    cut(0);
    return cut;
  }

  function shelter(world,surface,mini) {
    const barn=Landforms.place(world,surface,at(1.02,-.19),.036);
    barn.name='Сеновал';
    for(const x of [-.41,.41]) for(const z of [-.31,.12]) {
      model(barn,'box','#8b6d52',[x,.326,z],[.063,.65,.063]);
      model(barn,'pebble','#9e9b80',[x,.026,z],[.087,.070,.084]);
    }
    for(let j=0;j<4;j++) {
      model(barn,'box',j%2?'#aa835d':'#b9986c',[0,.12+j*.096,-.301],[.815,.092,.051]);
      model(barn,'box','#a4845d',[.414,.105+j*.086,-.098],[.045,.083,.405]);
    }
    for(const x of [-.236,.239]) {
      model(barn,'box','#8e7760',[x,.620,-.17],[.54,.069,.514],[0,0,x>0?-.29:.29]);
      for(let j=0;j<3;j++) model(barn,'box',j%2?'#89956f':'#758768',[x,.663,-.344+j*.164],
        [.538,.041,.169],[0,0,x>0?-.29:.29]);
    }
    model(barn,'box','#b19469',[0,.739,-.17],[.112,.042,.523]);
    const hay=new Group();
    hay.position.set(.031,.018,.089);
    hay.name='Куча сена';
    barn.add(hay);
    for(const [i,[x,y,z,w,h,d]] of [[0,.13,0,.336,.139,.245],[-.10,.213,-.042,.221,.121,.181],
      [.15,.196,.007,.171,.129,.151],[-.056,.285,.02,.152,.096,.128],[.073,.263,.091,.124,.089,.122]].entries()) {
      model(hay,'pebble',golden[i%4],[x,y,z],[w,h,d],[0,i*.74,.18]);
    }
    const outside=Landforms.place(world,surface,at(.56,-.69),.013,-.24);
    outside.name='Сено на просушке';
    for(const x of [-.12,.12]) model(outside,'stem','#916e56',[x,.125,0],[.032,.27,.032]);
    model(outside,'stem','#a38361',[0,.251,0],[.023,.33,.024],[0,0,Math.PI/2]);
    model(outside,'pebble','#d7b875',[0,.245,.019],[.231,.091,.095],[.14,0,-.11]);
    model(outside,'pebble','#c6a467',[-.016,.289,.026],[.168,.071,.072],[0,0,.17]);
    if(!mini) batchRepeatedParts(outside);
    const lamp=Landforms.lamp(barn,-.50,.011,.305,true);
    batchRepeatedParts(barn,hay);
    return {hay,lamp};
  }

  function create(world,surface,mini) {
    const cut=field(world,surface,mini);
    const {hay,lamp}=shelter(world,surface,mini);
    if(mini) return lamp;
    const mower=Inhabitants.resident(world,'maker',1.03);
    mower.base.name='Косарь';
    function tool(parent) {
      const shank=new Group();
      parent.add(shank);
      model(shank,'stem','#96704d',[0,-.097,0],[.014,.577,.014],[0,0,.039]);
      model(shank,'stem','#b79974',[-.030,.073,.029],[.015,.129,.015],[1.05,0,-.48]);
      const blade=new THREE.Shape();
      blade.moveTo(-.023,.027);
      blade.quadraticCurveTo(.16,.10,.313,-.034);
      blade.quadraticCurveTo(.119,.022,-.023,-.025);
      blade.closePath();
      model(shank,new THREE.ShapeGeometry(blade).rotateX(-Math.PI/2),
        new THREE.MeshStandardMaterial({color:'#97a89d',roughness:.38,side:THREE.DoubleSide}),[0,-.378,.008],[1,1,1]);
      return shank;
    }
    const scythe=tool(mower.hands[1]);
    scythe.name='Коса';
    const abandoned=Landforms.place(world,surface,at(.146,-.62),.014,.93);
    const parked=tool(abandoned);
    parked.position.y=.381;
    parked.rotation.z=.38;
    const armful=new Group();
    armful.name='Охапка сена';
    armful.position.set(-.065,-.037,.058);
    mower.hands[1].add(armful);
    for(let i=0;i<6;i++) model(armful,'pebble',golden[i%4],
      [(i%3-1)*.047,Math.sin(i*2)*.036,.011+(i%2)*.014],[.102,.043,.061],[.04,i*.29,.47]);
    const collected=Landforms.place(world,surface,at(.22,-.56),.012,0);
    for(let i=0;i<4;i++) model(collected,'pebble',golden[i],
      [(i%2-.5)*.078,.030+i*.013,(i%3-.5)*.046],[.091,.037,.086],[0,i*.69,-.09]);
    const gesture={};
    const phase=(t,a,b,c,d)=>smoothstep(t,a,b)-smoothstep(t,c,d);
    return (seconds,night)=>{
      lamp(seconds,night);
      const t=seconds%cycle;
      cut(t);
      const index=route.findIndex(([time])=>time>t);
      const [start,x,z,yaw]=route[index-1],[end,toX,toZ,toYaw]=route[index];
      const u=smoothstep(t,start,end);
      const turn=euclideanModulo(toYaw-yaw+180,360)-180;
      const p=at(lerp(x,toX,u),lerp(z,toZ,u));
      const {position,rotation}=surface.frameAt(p.lon,p.lat,.014);
      mower.base.position.copy(position);
      mower.base.quaternion.copy(rotation);
      mower.base.rotateY(degToRad(yaw+turn*u));
      const mow=Math.max(...pass.map(([a,b])=>phase(t,a-.31,a,b-.18,b+.17)));
      const sweep=Math.sin(t*6.5)*mow;
      const pick=phase(t,16.38,17.13,17.54,18.12);
      const carry=phase(t,17.20,17.73,23.46,24.12);
      const unload=phase(t,22.87,23.46,24.04,24.72);
      const walk=clamp(Math.hypot(toX-x,toZ-z)/(end-start)*3.1,0,.90)*Math.sin(Math.PI*u)**.38;
      gesture.leftReach=.63*carry+.68*pick+.55*unload;
      gesture.rightRoll=.34*mow+.65*sweep+.20*carry;
      gesture.lookDown=.28*mow+.38*pick+.35*unload;
      gesture.lean=.15*mow+.32*pick+.20*unload;
      gesture.crouch=.068*pick+.036*unload;
      mower.pose(seconds,walk,.24+.18*mow+.51*carry+.68*pick+.47*unload,0,gesture);
      scythe.visible=t<16.32;
      scythe.rotation.set(.19+.40*mow,.10+sweep*.57,-.16-.76*mow);
      parked.visible=!scythe.visible;
      collected.visible=t>10.94 && t<17.34;
      armful.visible=carry>.10;
      hay.scale.y=1+.17*(smoothstep(t,23.48,24.21)-smoothstep(t,29.1,cycle));
    };
  }

  return {site,reserve,create};
})();

;
const CloverFauna=(()=>{
  const {Group,Vector3}=THREE;
  const {lerp,smoothstep,euclideanModulo}=THREE.MathUtils;
  const {model,makeDecoration,batchRepeatedParts}=Scenery;
  const site={lon:2.27,lat:.019};
  const cone=new THREE.ConeGeometry(1,1,5);

  function at(spot,x,z) {
    return {lon:spot.lon+x/(Land.radius*Math.cos(spot.lat)),lat:spot.lat-z/Land.radius};
  }

  function bird(parent,kind) {
    const base=new Group(),head=new Group();
    const pecker=kind==='woodpecker';
    parent.add(base);
    const back=pecker?'#3c534d':'#82765b';
    const chest=pecker?'#e2d7b8':'#bc624c';
    model(base,'pebble',back,[0,.090,-.012],[.074,.096,.100],[.15,0,.13]);
    model(base,'round',chest,[0,.086,.054],[.066,.077,.061],[.28,0,0]);
    const tail=model(base,'tiny',back,[0,.061,-.115],[.035,.022,.102],[-.36,0,.13]);
    const wings=[];
    for(const side of [-1,1]) {
      const wing=new Group();
      wing.position.set(side*.045,.120,-.011);
      base.add(wing);
      model(wing,'pebble',back,[side*.034,-.014,-.027],[.046,.043,.079],[0,side*.35,side*.47]);
      if(pecker) model(wing,'tiny','#cbc9ae',[side*.062,-.005,-.021],[.027,.024,.048],[0,side*.27,side*.41]);
      wings.push(wing);
      model(base,'stem','#b68d63',[side*.022,.024,.027],[.009,.049,.009],[0,0,side*.11]);
    }
    head.position.set(0,.165,.039);
    base.add(head);
    model(head,'round',back,[0,0,.005],[.061,.061,.061]);
    if(pecker) {
      model(head,'tiny','#bb5b4e',[0,.047,.002],[.043,.024,.042]);
      for(const side of [-1,1]) model(head,'tiny','#e1d9ba',[side*.037,-.015,.039],[.027,.029,.026]);
    } else model(head,'tiny','#ca7456',[0,-.022,.043],[.046,.032,.028]);
    model(head,cone,pecker?'#78766a':'#d4ab67',[0,-.013,pecker?.084:.068],
      pecker?[.019,.068,.017]:[.019,.037,.019],[Math.PI*.5,0,0]);
    for(const side of [-1,1]) {
      model(head,'tiny','#3a3c34',[side*.042,.004,.043],[.011,.013,.009]);
      model(head,'tiny','#fae8c7',[side*.041-.003,.008,.050],[.004,.005,.003]);
    }
    batchRepeatedParts(head);
    base.traverse(part=>{if(part.isMesh) part.castShadow=false;});
    function pose(t,fly,peck) {
      head.rotation.x=.83*peck+.058*Math.sin(t*3.4);
      head.rotation.y=.17*Math.sin(t*2.2)*(1-peck);
      tail.rotation.x=-.36+.14*Math.sin(t*3.1);
      for(const [i,wing] of wings.entries()) wing.rotation.z=(i?1:-1)*fly*(.79+.64*Math.sin(t*24));
    }
    return {base,pose};
  }

  function woodland(world,surface,mini) {
    const batch=makeDecoration(world,surface.frameAt);
    for(const [i,[x,z,s]] of [[-.79,.05,1.08],[-.52,-.45,.81],[-.63,.53,.90],[-.34,.78,.69],[.32,.76,.75],
      [.79,.54,.93],[.91,.18,.83],[.64,-.37,.99],[.10,-.53,.72],[.92,-.05,.88],[-1.07,.58,.68]].entries()) {
      const p=at(site,x,z);
      batch.positionAt(p.lon,p.lat,-.022,i*.83,s);
      batch.add('pebble','#809387',[0,.064,0],[.205,.155,.176],[.14,0,-.2],!mini);
      batch.add('pebble','#91a676',[.056,.155,.024],[.151,.092,.128],[.05,.24,.12],false);
      for(let j=0;j<5;j++) {
        const alpha=j*2.399,h=.082+.046*((j+i)%4);
        batch.add('tiny',j%2?'#89a269':'#6e9469',[.147*Math.cos(alpha),h*.52,.135*Math.sin(alpha)],
          [.022,h,.024],[.19*Math.cos(alpha),alpha,-.35*Math.sin(alpha)],false);
      }
      if(i%3!==0) continue;
      for(const side of [-1,1]) {
        batch.add('stem','#c9baa0',[side*.058,.059,.12],[.019,.111,.021],[0,0,side*.3],false);
        batch.add('tiny',side>0?'#b78161':'#c59471',[side*.076,.113,.12],[.056,.033,.054],[0,0,side*.27],false);
      }
    }
    const slab=at(site,-.22,.35);
    batch.positionAt(slab.lon,slab.lat,-.015,1.22);
    batch.add('stem','#7d634f',[0,.075,-.036],[.131,.84,.125],[Math.PI/2,0,0],!mini);
    batch.add('stem','#b7a180',[0,.077,.393],[.101,.017,.098],[Math.PI/2,0,0],false);
    batch.add('pebble','#90a36e',[.031,.163,-.131],[.131,.071,.26],[0,.19,0],false);
    batch.commit();

    const snag=Landforms.place(world,surface,at(site,-.27,-.27),.013,.13);
    snag.name='Сухой ствол дятла';
    model(snag,'stem','#886e57',[0,.429,0],[.128,.91,.126],[.043,0,.098]);
    model(snag,'pebble','#c0a98a',[-.056,.859,.006],[.100,.058,.108],[0,.3,.19]);
    model(snag,'stem','#92765a',[-.128,.491,-.034],[.040,.261,.039],[.17,0,-.67]);
    model(snag,'round','#534d42',[-.033,.580,.111],[.040,.058,.018]);
    model(snag,'pebble','#7d9c70',[.056,.102,.02],[.13,.110,.144]);
    batchRepeatedParts(snag);
    if(mini) return;
    const woodpecker=bird(snag,'woodpecker');
    woodpecker.base.name='Дятел';
    const hedgehog=new Group();
    hedgehog.name='Еж у бревна';
    world.add(hedgehog);
    const body=new Group();
    hedgehog.add(body);
    model(body,'round','#846b5a',[0,.089,-.062],[.106,.089,.149]);
    for(let j=0;j<8;j++) {
      const a=j*2.399;
      model(body,cone,j%2?'#8b7863':'#aa9276',[.065*Math.cos(a),.139+j%2*.021,-.063+.091*Math.sin(a)],
        [.037,.109,.042],[.16*Math.sin(a),a,.42*Math.cos(a)]);
    }
    const muzzle=new Group();
    muzzle.position.set(0,.087,.045);
    body.add(muzzle);
    model(muzzle,'round','#c3a88a',[0,0,.036],[.065,.061,.079]);
    model(muzzle,'tiny','#514a3e',[0,-.009,.107],[.022,.027,.019]);
    for(const side of [-1,1]) {
      model(muzzle,'tiny','#534b3e',[side*.045,.021,.067],[.013,.014,.010]);
      model(body,'tiny','#af9070',[side*.063,.032,.071],[.028,.025,.045]);
    }
    batchRepeatedParts(body,muzzle);
    return (seconds,night)=>{
      const t=(seconds+1.6)%15;
      const climb=smoothstep(t,3.2,3.6)*.137+smoothstep(t,7.50,7.9)*.157;
      const landing=smoothstep(t,11.3,12.85);
      const hop=Math.sin(t*Math.PI*2)*.015*(1-smoothstep(t,10.8,11.7));
      const fly=.46*Math.sin(landing*Math.PI);
      woodpecker.base.position.set(-.040+.29*Math.sin(landing*Math.PI),.16+climb*(1-landing)+hop+.12*fly,.228+.19*fly);
      woodpecker.base.rotation.y=Math.PI+landing*Land.tau;
      const tapping=(smoothstep(t,1.05,1.4)-smoothstep(t,2.52,2.93))+(smoothstep(t,4.5,4.8)-smoothstep(t,6.58,6.85))
        +(smoothstep(t,8.25,8.56)-smoothstep(t,10.58,10.83));
      woodpecker.pose(seconds,fly,Math.max(0,Math.sin(t*39))*.62*tapping);

      const idle=20-7*night;
      const q=(seconds+2)%idle;
      const out=smoothstep(q,1.9,5.14),back=smoothstep(q,idle-6.0,idle-1.37);
      const walk=out-back;
      const p=at(site,lerp(.12,.49,walk),lerp(.39,.68,walk));
      const frame=surface.frameAt(p.lon,p.lat,.012);
      hedgehog.position.copy(frame.position);
      hedgehog.quaternion.copy(frame.rotation);
      hedgehog.rotateY(.88+Math.PI*(smoothstep(q,idle-6.3,idle-5.72)-smoothstep(q,idle-1.37,idle-.72)));
      const padding=(0<walk&&walk<1)?1:0;
      body.position.y=.010*Math.abs(Math.sin(seconds*12))*padding;
      muzzle.rotation.x=.28*Math.sin(seconds*8)*smoothstep(q,5.07,5.4);
    };
  }

  function robin(world,surface) {
    const spot={lon:-.38,lat:.892};
    const frame=Landforms.place(world,surface,spot,.006,.14);
    model(frame,'pebble','#8f9e87',[0,.127,-.12],[.237,.192,.178],[.12,.4,.24]);
    model(frame,'pebble','#98aa74',[-.04,.243,-.101],[.199,.094,.143],[.05,.2,-.13]);
    const redbreast=bird(frame,'robin');
    redbreast.base.name='Зарянка';
    return (seconds)=>{
      const t=(seconds+1.13)%12.4;
      const step1=smoothstep(t,2.16,2.68), step2=smoothstep(t,4.25,4.91), home=smoothstep(t,9.42,10.76);
      const bounce=(Math.sin(Math.PI*step1)+Math.sin(Math.PI*step2))*.13;
      const flying=Math.sin(Math.PI*home);
      redbreast.base.position.set(lerp(.02,-.35,step1-home)+.17*step2*(1-home),
        .33*(1-step1+home)+.036*step1*(1-home)+bounce+.39*flying,
        -.067+.32*(step1-home)+.17*step2*(1-home));
      redbreast.base.rotation.y=-.92+1.91*step2+2.16*smoothstep(t,9.18,9.56)-4.07*smoothstep(t,10.77,11.61);
      const peck=(1-home)*smoothstep(t,5.11,5.5)*Math.max(0,Math.sin(t*13))*.89;
      redbreast.pose(seconds,flying,peck);
    };
  }

  function grasshoppers(world,surface) {
    const spots=[{lon:.414,lat:.44},{lon:1.42,lat:-.48},{lon:2.70,lat:.69},
      {lon:-2.67,lat:-.36},{lon:-1.26,lat:-.32},{lon:-.84,lat:.88}];
    const jumpers=spots.map((spot,i)=>{
      const insect=new Group();
      insect.name=`Кузнечик ${i+1}`;
      world.add(insect);
      model(insect,'tiny','#729655',[0,.064,-.024],[.030,.028,.081]);
      model(insect,'tiny','#a4b960',[0,.079,-.031],[.024,.014,.071]);
      model(insect,'tiny','#83a751',[0,.071,.043],[.032,.033,.035]);
      const antennae=[];
      for(const side of [-1,1]) {
        model(insect,'stem','#5b8b55',[side*.036,.048,-.021],[.009,.082,.010],[.91,0,side*.38]);
        model(insect,'stem','#788b50',[side*.047,.024,-.061],[.006,.082,.006],[-1.11,0,side*.24]);
        model(insect,'tiny','#424e3d',[side*.022,.087,.058],[.009,.009,.008]);
        antennae.push(model(insect,'stem','#758952',[side*.018,.110,.079],[.004,.064,.004],[.86,0,-side*.38]));
      }
      insect.traverse(part=>{if(part.isMesh) part.castShadow=false;});
      return {insect,spot,antennae};
    });
    return (seconds)=>{
      for(const [i,{insect,spot,antennae}] of jumpers.entries()) {
        const t=euclideanModulo(seconds+i*2.13,10.6);
        const first=smoothstep(t,1.75,2.12),second=smoothstep(t,4.65,5.01),back=smoothstep(t,8.09,8.57);
        const p=at(spot,first*.23+second*.29-back*.52,first*.12-second*.11-back*.01);
        const jump=.22*Math.sin(first*Math.PI)+.25*Math.sin(second*Math.PI)+.25*Math.sin(back*Math.PI);
        const frame=surface.frameAt(p.lon,p.lat,.008+jump);
        insect.position.copy(frame.position);
        insect.quaternion.copy(frame.rotation);
        insect.rotateY(1.07+.92*second+2.83*back-3.75*smoothstep(t,9.53,10.24));
        for(const [k,feel] of antennae.entries()) feel.rotation.x=.80+.36*Math.sin(seconds*5+i+k*.92);
      }
    };
  }

  function leafCrawlers(world,surface) {
    const coneShell=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({length:23},(_,i)=>{
      const t=i/22,a=t*Land.tau*1.54,r=.036*t+.005;
      return new Vector3(0,Math.cos(a)*r,Math.sin(a)*r);
    })),20,.004,4,false);
    const crawlers=[];
    const life=[
      ['Гусеница',-.62,-.20,.86],['Гусеница',.54,-.636,.67],['Гусеница',1.92,.53,1.11],
      ['Гусеница',-2.31,.58,.91],['Гусеница',2.79,-.84,.74],
      ['Улитка',-.18,-.55,1],['Улитка',1.83,-.15,.79],['Улитка',-2.97,.30,.93]
    ];
    for(const [i,[kind,lon,lat,size]] of life.entries()) {
      const spot={lon,lat};
      const root=Landforms.place(world,surface,spot,.010,i*1.41);
      const actor=new Group();
      actor.name=`${kind} ${kind==='Гусеница'?i+1:i-4}`;
      actor.scale.setScalar(size);
      root.add(actor);
      model(root,'pebble','#a1ad86',[.017,.024,.015],[.135,.059,.176],[0,.3,-.24]);
      model(root,'tiny','#84a36a',[-.039,.081,.011],[.085,.022,.108],[.15,0,.28]);
      const parts=[];
      if(kind==='Гусеница') {
        for(let j=0;j<6;j++) {
          const blob=model(actor,'tiny',j%2?'#aabe65':'#93ab59',[0,0,0],[.024,.022,.025]);
          blob.castShadow=false;
          parts.push(blob);
        }
        const head=parts[5];
        for(const side of [-1,1]) model(head,'tiny','#526146',[side*.51,.22,.77],[.17,.16,.14]);
      } else {
        model(actor,'tiny','#ba9c75',[0,.017,.023],[.026,.019,.087]);
        model(actor,'pebble',i%2?'#a98268':'#c09871',[0,.053,-.004],[.056,.052,.053]);
        for(const side of [-1,1]) {
          model(actor,coneShell,'#855f52',[side*.045,.055,-.005],[1,.91,.91]);
          const feel=model(actor,'stem','#876e56',[side*.008,.042,.077],[.005,.045,.005],[.4,0,side*.31]);
          parts.push(feel);
        }
      }
      actor.traverse(part=>{if(part.isMesh) part.castShadow=false;});
      crawlers.push({actor,parts,kind});
    }
    return (seconds)=>{
      for(const [i,{actor,parts,kind}] of crawlers.entries()) {
        const time=seconds*(kind==='Улитка'?.34:.57)+i*3.73;
        const angle=time*.51;
        actor.position.set(.059*Math.sin(angle),.068,.086*Math.cos(angle));
        actor.rotation.y=angle+1.24;
        if(kind==='Гусеница') {
          for(const [j,blob] of parts.entries()) blob.position.set(.006*Math.sin(time*10+j),.016+.012*Math.sin(time*9-j*.56),
            (j-2)*.025+.008*Math.sin(time*10-j));
        } else {
          for(const [j,feel] of parts.entries()) feel.rotation.x=.40+.28*Math.sin(time*2+j);
        }
      }
    };
  }

  function roamingHedgehogs(world,surface) {
    const wanderers=[{lon:-2.35,lat:.71},{lon:.81,lat:-.77}].map((spot,index)=>{
      const animal=new Group();
      animal.name=index===0?'Еж на северном склоне':'Еж на южном склоне';
      world.add(animal);
      const shell=model(animal,'pebble','#897461',[0,.082,-.045],[.106,.092,.139]);
      for(let i=0;i<8;i++) {
        const a=i*2.4;
        model(animal,cone,i%2?'#8e7864':'#ad9475',[.076*Math.cos(a),.127+i%2*.024,-.060+.099*Math.sin(a)],
          [.025,.083,.027],[.28*Math.sin(a),a,-.33*Math.cos(a)]);
      }
      model(animal,'round','#bca081',[0,.075,.059],[.055,.055,.072]);
      model(animal,'tiny','#5f5045',[0,.068,.128],[.015,.018,.017]);
      for(const side of [-1,1]) model(animal,'tiny','#49483e',[side*.040,.087,.087],[.010,.011,.009]);
      batchRepeatedParts(animal,shell);
      const scatter=Landforms.place(world,surface,at(spot,.26,.21),.015,.2);
      model(scatter,'pebble','#95a789',[.04,.046,.016],[.161,.095,.121]);
      for(const x of [-.062,.069]) {
        model(scatter,'stem','#c6b59a',[x,.053,.117],[.017,.10,.017]);
        model(scatter,'tiny','#ac805e',[x,.106,.117],[.042,.029,.037]);
      }
      return {animal,spot,shell};
    });
    return (seconds)=>{
      for(const [i,{animal,spot,shell}] of wanderers.entries()) {
        const t=euclideanModulo(seconds+i*7,19.6);
        const outward=smoothstep(t,2.0,6.3)-smoothstep(t,12.1,17.7);
        const pos=at(spot,-.24+outward*.62,-.16+outward*.44);
        const f=surface.frameAt(pos.lon,pos.lat,.013);
        animal.position.copy(f.position);
        animal.quaternion.copy(f.rotation);
        animal.rotateY(.95+Math.PI*(smoothstep(t,11.7,12.37)-smoothstep(t,17.36,18.14)));
        shell.scale.y=.092+.01*Math.sin(seconds*6+i);
      }
    };
  }

  function create(world,surface,mini) {
    const woods=woodland(world,surface,mini);
    if(mini) return;
    const redbreast=robin(world,surface);
    const hoppers=grasshoppers(world,surface);
    const crawlers=leafCrawlers(world,surface);
    const wanderers=roamingHedgehogs(world,surface);
    return (seconds,night)=>{
      woods(seconds,night);
      redbreast(seconds);
      hoppers(seconds);
      crawlers(seconds);
      wanderers(seconds);
    };
  }

  return {site,create};
})();

;
const Clover = (() => {
  const {Color, Group, Mesh, Vector2, Vector3} = THREE;
  const {model, makeDecoration, batchRepeatedParts} = Scenery;
  const {clamp, smoothstep, lerp} = THREE.MathUtils;
  const waterRadius=Land.radius+Land.waterLevel;
  const view={lon:.25,lat:.17};
  const pasture={lon:.71,lat:.38};
  const cabin={lon:-.36,lat:.56};
  const spring={lon:.08,lat:.202};
  const arch={lon:-2.72,lat:.20};
  const wallow=CloverWallow.site;
  const pools=[
    {lon:.15,lat:-.126,width:1.31,depth:1.12},
    {lon:2.46,lat:-.30,width:.79,depth:.63}
  ];
  const stops=[{label:'Lake',...pools[0],zoom:.63},{label:'Shepherd’s Cottage',...cabin,zoom:.60},
    {label:'Stone Gate',...arch,zoom:.65},{label:'Birch Grove',...wallow,zoom:.69,tilt:.17},
    {label:'Hayfield',...CloverHay.site,zoom:.66,tilt:.12},{label:'Fir Hollow',...CloverFauna.site,zoom:.66}];

  function local(spot,x,z) {
    return {lon:spot.lon+x/(Land.radius*Math.cos(spot.lat)),lat:spot.lat-z/Land.radius};
  }

  function axes(spot) {
    const normal=Land.direction(spot.lon,spot.lat);
    const rotation=Land.frame(spot.lon,spot.lat).rotation;
    return {normal,east:new Vector3(Land.radius,0,0).applyQuaternion(rotation),
      south:new Vector3(0,0,Land.radius).applyQuaternion(rotation)};
  }

  const basins=pools.map(pool=>({...pool,...axes(pool)}));
  const mud=axes(wallow);
  const slopes=[
    {lon:-.39,lat:.72,w:1.42,d:1.10,height:.52},
    {...CloverHay.site,w:1.52,d:1.11,height:.26},
    {lon:.14,lat:.45,w:.76,d:.61,height:.15},
    {lon:.94,lat:.47,w:1.47,d:1.60,height:.26},
    {lon:2.83,lat:.43,w:1.30,d:1.0,height:.44},
    {lon:-1.55,lat:-.44,w:1.12,d:1.71,height:.34}
  ].map(slope=>({...slope,...axes(slope)}));

  function margin(n) {
    let edge=1;
    for(const basin of basins) {
      if(n.dot(basin.normal)<.83) continue;
      const x=n.dot(basin.east)/basin.width,z=n.dot(basin.south)/basin.depth;
      const angle=Math.atan2(z,x);
      const shoreline=.116*Math.sin(angle*3+.5)+.071*Math.sin(angle*5-1.1)+.036*Math.cos(angle*7);
      edge=Math.min(edge,(Math.hypot(x,z)-1+shoreline)*.29);
    }
    return edge;
  }

  function point(lon,lat,offset=0) {
    const n=Land.direction(lon,lat);
    const {x,y,z}=n;
    let relief=.15+.088*Math.sin(x*7+z*3)*Math.cos(z*8-y*4)+.028*Math.sin(x*21-y*8+z*6);
    for(const slope of slopes) {
      const facing=n.dot(slope.normal);
      if(facing<.80) continue;
      relief+=slope.height*Math.exp(-((n.dot(slope.east)/slope.w)**2+(n.dot(slope.south)/slope.d)**2))
        *smoothstep(facing,.80,.90);
    }
    if(n.dot(mud.normal)>.96) {
      const oval=Math.hypot(n.dot(mud.east)/.71,n.dot(mud.south)/.48);
      relief-=.065*(1-smoothstep(oval,.52,1.14));
    }
    return n.multiplyScalar(Land.radius+offset+lerp(-.21,relief,smoothstep(margin(n),-.048,.114)));
  }

  const frameAt=(lon,lat,offset)=>({...Land.frame(lon,lat),position:point(lon,lat,offset)});
  const surface={point,frameAt};

  function ground(world,mini) {
    const slices=mini?44:144,bands=mini?24:80;
    const moss=new Color('#7d9f58'),grass=new Color('#b3c681'),heather=new Color('#8b9a74'),bank=new Color('#b7bd8e');
    const earth=Land.globeGeometry(slices,bands,(lon,lat)=>{
      const n=Land.direction(lon,lat),{x,y,z}=n;
      const cover=.46+.27*Math.sin(x*5+z*7)*Math.cos(y*8+z*4)+.10*Math.sin(x*29-y*24)*Math.cos(z*28);
      const color=moss.clone().lerp(grass,clamp(cover,0,1));
      color.lerp(heather,smoothstep(Math.sin(x*7-y*9+z*6),.48,1)*.24);
      color.lerp(bank,(1-smoothstep(margin(n),.03,.095))*.60);
      return {position:point(lon,lat),color};
    });
    const land=new Mesh(earth,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
    land.receiveShadow=!mini;
    world.add(land);

    const deep=new Color('#288e90'),shoal=new Color('#79c7ae'),foam=new Color('#e5eccc');
    const waterGeo=Land.globeGeometry(slices,bands,(lon,lat)=>{
      const n=Land.direction(lon,lat);
      const edge=margin(n);
      const color=deep.clone().lerp(shoal,(1-smoothstep(-edge,.01,.18))*.92);
      color.lerp(foam,(1-smoothstep(Math.abs(edge+.016),.003,.046))*.36);
      return {position:n.multiplyScalar(waterRadius),color};
    });
    const current={value:0};
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.68});
    if(!mini) material.onBeforeCompile=(shader)=>{
      shader.uniforms.uCloverTime=current;
      shader.vertexShader='varying vec3 vLake;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLake=position;');
      shader.fragmentShader='varying vec3 vLake; uniform float uCloverTime;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float stripe = sin(vLake.y*31.0 + vLake.x*11.0 + sin(vLake.z*6.0)*1.1 - uCloverTime*1.42);
        float gaps = sin(vLake.x*27.0-vLake.y*4.2+uCloverTime*.54)*.64+cos(vLake.z*22.0+vLake.y*13.0)*.36;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.61,.89,.77),smoothstep(.86,1.0,stripe)*smoothstep(.29,.9,gaps)*.31);`);
    };
    const water=new Mesh(waterGeo,material);
    water.receiveShadow=!mini;
    world.add(water);
    return current;
  }

  const herdTrail=new THREE.SplineCurve([
    [-.078,.76],[-.068,.47],[-.018,.19],[.18,-.11],[.53,-.20],[.89,-.17],[1.34,.07],
    [1.60,.65],[1.32,1.33],[.65,1.99],[.05,2.23],[-.34,2.08],[-.44,1.72],[-.31,1.32],[-.15,1.01],[-.078,.76]
  ].map(([x,z])=>{
    const p=local(pasture,x,z);
    return new Vector2(p.lon,p.lat);
  }));

  function fir(add,random,shadow) {
    add('stem','#896c54',[0,.36,0],[.063,.76,.062],[0,0,.065],shadow);
    const greens=['#356459','#437563','#55826a','#6b9270'];
    const bend=(random()-.51)*.16;
    for(let i=0;i<greens.length;i++) {
      const width=[.43,.345,.248,.143][i];
      add('firCrown',greens[i],[bend*i,.567+i*.246,i*.019],[width,.55-i*.035,width*(.9+random()*.18)],
        [.022*i,i*.69+bend,bend*.24],shadow);
    }
  }

  function birch(add,random,shadow) {
    const trunks=[[-.093,-.028,.91,.21], [.039,.024,1.19,-.115], [.15,-.058,.83,-.25]];
    for(const [index,[x,z,h,lean]] of trunks.entries()) {
      const radius=.044+(index===1?.009:0);
      const center=x-Math.sin(lean)*h*.5;
      add('stem',index===1?'#e4ddc8':'#d6d3bf',[center,h*.49,z],[radius,h,radius*.94],[0,0,lean],shadow);
      for(let j=0;j<(shadow?4:3);j++) {
        const y=h*(.18+j*.168),stemX=x-Math.sin(lean)*y;
        const a=j*2.40+index*.81;
        for(const side of [-1,1]) add('box',j%2?'#776c60':'#66594f',
          [stemX+side*Math.cos(a)*radius*.79,y,z+side*Math.sin(a)*radius*.74],
          [.034+j%2*.008,.013,.009],[0,Math.PI/2-a,lean+.13],false);
      }
      const top=x-Math.sin(lean)*h;
      for(let k=0;k<4;k++) {
        const a=k*2.39+index*1.22;
        const tint=['#94ac71','#afbd7c','#c0c98b','#839e68'][(k+index)%4];
        const width=.158+random()*.073;
        add('pebble',tint,[top+.11*Math.cos(a),h+.026+.11*(k%3),z+.129*Math.sin(a)],
          [width,.142+k*.011,width*.94],[.12,a,.21],shadow);
      }
    }
  }

  function plants(world,mini) {
    const random=Land.rng(342923);
    const {positionAt,add,commit}=makeDecoration(world,frameAt);
    const groves=[[-.87,.63],[-.62,.97],[.38,.87],[1.46,.24],[1.29,-.47],[-.64,-.36],[-1.26,.28],
      [-1.23,-.59],[-1.94,-.28],[-2.35,.61],[-2.85,-.22],[2.63,.69],[2.11,.22],[1.97,-.68],[-2.32,-.94],
      [.38,-1.01],[-1.66,.07],[-2.16,-.58],[2.94,-.04],[1.56,.71],[.34,-.68]];
    const route=herdTrail.getPoints(22);
    for(const [k,[lon,lat]] of groves.entries()) {
      for(let i=0;i<(mini?2:4);i++) {
        const x=lon+(random()-.5)*.31,y=lat+(random()-.5)*.24;
        if(margin(Land.direction(x,y))<.11 || route.some(p=>Math.hypot(p.x-x,p.y-y)<.10)
          || Math.hypot((x-wallow.lon)*Math.cos(wallow.lat),y-wallow.lat)<.33 || CloverHay.reserve(x,y)) continue;
        positionAt(x,y,-.043,random()*Land.tau,.65+random()*.47);
        if(k%6===4 && i%2===0) birch(add,random,!mini);
        else fir(add,random,!mini);
      }
    }

    const birches=[[-.42,.50,.70,0],[-.78,.28,.82,2.43],[.55,.71,.78,1.45],[2.24,-.12,.82,2.65]];
    for(const [x,z,size,yaw] of [[-.90,-.46,.98,.4],[-.13,-.84,.91,1.5],[.78,-.49,.79,2.3],
      [-1.03,.49,.78,1.1],[.30,.86,.79,3.08]]) {
      const p=local(wallow,x,z);
      birches.push([p.lon,p.lat,size,yaw]);
    }
    for(const [lon,lat,size,yaw] of birches) {
      positionAt(lon,lat,-.036,yaw,size);
      birch(add,random,!mini);
    }

    const beds=[[-.57,.39],[-.09,.57],[.04,.31],[.31,.47],[.38,.295],[.51,.56],[.89,.58],[1.28,.19],[.61,-.28],
      [.40,-.44],[-.43,-.23],[-.39,.08],[-.86,.29],[-1.29,-.40],[-2.33,.30],[-2.84,.12],
      [-2.45,-.45],[2.92,.68],[2.45,.22],[2.92,-.49],[1.87,-.43],[-.57,-.92],[-2.14,-.81],
      [-1.71,.45],[-1.56,-.24],[-2.16,.02],[-2.65,.40],[-2.70,-.61],[2.31,.50],[.88,-.63],
      [1.09,.76],[-.98,-.85],[2.64,-.93],[-1.07,.94],...groves];
    for(const [k,[lon,lat]] of beds.entries()) {
      for(let i=0;i<(mini?4:15);i++) {
        const x=lon+(random()-.5)*.24,y=lat+(random()-.5)*.20;
        if(margin(Land.direction(x,y))<.041 || Math.hypot((x-wallow.lon)*Math.cos(wallow.lat),y-wallow.lat)<.25
          || CloverHay.reserve(x,y,.75)) continue;
        positionAt(x,y,-.012,random()*Land.tau,.66+random()*.48);
        for(let j=-1;j<=1;j++) {
          const height=.064+random()*.095;
          add('tiny',j===0?'#a2ba61':'#759a59',[j*.029,height*.59,.026*j],[.016,height,.013],[0,0,-j*.42],false);
        }
        if(i%4===0) {
          add('pebble',k%3?'#779761':'#a8a58a',[.07,.062,.066],[.14,.128,.132],[0,.3,.1],false);
          add('pebble',k%2?'#9ca96a':'#74916b',[-.055,.073,-.01],[.147,.11,.113],[0,.3,.1],false);
        }
        if(i%3!==1) continue;
        const h=.10+random()*.12;
        const flower=['#ad8ebb','#e5d6a9','#dca7a5','#cab1cb'][k%4];
        add('stem','#72894f',[0,h*.48,0],[.012,h,.009],null,false);
        for(let j=0;j<5;j++) {
          const a=j*Land.tau/5;
          add('tiny',flower,[.027*Math.cos(a),h,.027*Math.sin(a)],[.024,.019,.018],[0,-a,0],false);
        }
        add('tiny','#eed498',[0,h+.012,0],[.016,.014,.016],null,false);
      }
    }
    const heatherSlope={lon:-1.76,lat:.17};
    for(const [i,[x,z,s]] of [[-.50,.23,.73],[-.23,-.23,1.27],[.19,-.37,1.15],
      [.48,-.15,.86],[.50,.29,.68],[-.13,.42,.81]].entries()) {
      const p=local(heatherSlope,x,z);
      positionAt(p.lon,p.lat,-.010,i*.81,s);
      add('pebble','#8e9d8d',[0,.077,0],[.234,.157,.181],[.22,0,-.12],!mini);
      add('pebble','#9cab78',[-.063,.144,.026],[.157,.105,.134],[0,.21,.14],false);
      for(let j=0;j<(mini?3:9);j++) {
        const a=j*2.399,w=.146+.076*Math.sin(j*4.2),h=.11+.048*(j%4);
        const x=Math.cos(a)*w,z=Math.sin(a)*.172;
        add('stem','#758963',[x,h*.5,z],[.010,h,.010],[0,0,-.17],false);
        add('tiny',j%2?'#ae8fae':'#8e77a9',[x+.009,h,z],[.030,.049,.026],[0,0,-.27],false);
        if(!mini && j%3===0) add('tiny','#d6aec4',[x-.009,h+.039,z],[.025,.031,.022],null,false);
      }
    }
    commit();
  }

  function hillTrail(world,mini) {
    const batch=makeDecoration(world,frameAt);
    const trail=new THREE.SplineCurve([
      [-.33,.438],[-.21,.430],[-.07,.414],[.081,.425],[.224,.434],[.346,.379],[.51,.321],[.607,.263],[.688,.225]
    ].map(([lon,lat])=>new Vector2(lon,lat)));
    for(const [i,p] of trail.getPoints(mini?12:23).entries()) {
      batch.positionAt(p.x,p.y,.005,i*1.15);
      batch.add('pebble',i%3?'#b7b39a':'#a4ae95',[0,0,0],[.065+i%4*.020,.024,.062+i%3*.021],[0,i*.72,0],false);
    }
    for(const [lon,lat,s] of [[-.19,.39,.91],[-.03,.473,.76],[.19,.478,.95],[.31,.34,.67],[.498,.37,.69]]) {
      batch.positionAt(lon,lat,-.016,lon*11,s);
      batch.add('pebble','#95a58a',[0,.049,0],[.232,.160,.173],[.19,.15,.27],!mini);
      batch.add('pebble','#aebb91',[.093,.115,-.012],[.143,.091,.118],[0,0,-.26],false);
      if(mini) continue;
      for(let i=0;i<5;i++) {
        const a=i*2.399,x=.22*Math.cos(a),z=.16*Math.sin(a),h=.073+i%3*.027;
        batch.add('stem','#708e51',[x,h*.53,z],[.012,h,.012],null,false);
        for(let j=0;j<3;j++) {
          const leaf=j*Land.tau/3;
          batch.add('tiny','#7eab64',[x+.033*Math.cos(leaf),h,z+.033*Math.sin(leaf)],
            [.035,.016,.029],[0,-leaf,0],false);
        }
        if(i%2===0) batch.add('tiny','#bf9cc3',[x+.054,h+.044,z+.025],[.029,.036,.029],null,false);
      }
    }
    batch.commit();
  }

  function chalet(world,mini) {
    const home=Landforms.place(world,surface,cabin,.012,-.25);
    home.name='Дом пастуха';
    model(home,'box','#806c62',[0,.062,0],[.99,.169,.71]);
    model(home,'box','#a97955',[0,.325,0],[.85,.58,.60]);
    for(let j=0;j<7;j++) {
      model(home,'box',j%2?'#bc8e65':'#cc9a6c',[(j-3)*.115,.326,.307],[.111,.53,.044]);
    }
    const gable=new THREE.Shape();
    gable.moveTo(-.41,0);
    gable.lineTo(.41,0);
    gable.lineTo(0,.338);
    gable.closePath();
    model(home,new THREE.ShapeGeometry(gable),'#ae8161',[0,.571,.311],[1,1,1]);
    model(home,'round','#755b52',[0,.695,.325],[.082,.081,.020]);
    model(home,'round','#cab593',[0,.695,.344],[.057,.055,.016]);
    for(const side of [-1,1]) {
      for(let j=0;j<4;j++) {
        model(home,'box',j%2?'#786171':'#876e79',[side*(.068+j*.123),.856-j*.109,.015],
          [.184,.075,.84],[0,0,side*-.72]);
      }
      model(home,'box','#875f4a',[side*.40,.255,.516],[.056,.53,.045]);
    }
    model(home,'box','#9a7075',[0,.923,.013],[.12,.073,.90]);
    model(home,'box','#a08a77',[-.28,.874,-.22],[.139,.38,.137]);
    model(home,'box','#74665f',[-.28,1.075,-.22],[.170,.073,.164]);
    model(home,'box','#7e6652',[0,.274,.338],[.223,.395,.064]);
    model(home,'box','#8f745c',[0,.122,.472],[.93,.091,.35]);
    model(home,'box','#ac8663',[0,.058,.63],[.43,.084,.159]);
    model(home,'box','#9f7c62',[0,.520,.450],[.93,.060,.29],[.145,0,0]);
    const glass=new THREE.MeshStandardMaterial({color:'#ebc792',emissive:'#f4a44f',emissiveIntensity:.02,roughness:.65});
    for(const side of [-1,1]) {
      model(home,'box','#795849',[side*.274,.353,.337],[.20,.192,.051]);
      model(home,'box',glass,[side*.274,.353,.368],[.147,.146,.021]);
      model(home,'box','#98654d',[side*.274,.353,.385],[.022,.151,.018]);
    }
    for(const [x,z] of [[-.53,.30],[.51,.48],[.52,.25]]) {
      model(home,'stem','#a58a69',[x,.056,z],[.068,.125,.065]);
      model(home,'tiny','#a892ac',[x,.123,z],[.047,.065,.044]);
    }
    const lamp=Landforms.lamp(home,.54,.026,.59,true);
    batchRepeatedParts(home);
    return (seconds,night)=>{
      glass.emissiveIntensity=.04+night*1.63;
      lamp(seconds,night);
    };
  }

  const lilyShape=new THREE.Shape();
  lilyShape.moveTo(.04,0);
  for(let j=0;j<=17;j++) {
    const a=.39+j/17*(Land.tau-.78);
    const lip=1+.08*Math.sin(a*3);
    lilyShape.lineTo(Math.cos(a)*lip,Math.sin(a)*.86*lip);
  }
  lilyShape.closePath();
  const leaf=new THREE.ShapeGeometry(lilyShape).rotateX(-Math.PI/2);

  function lakeside(world,mini) {
    const waterRoot=Landforms.place(world,surface,pools[0]);
    waterRoot.position.setLength(waterRadius);
    waterRoot.name='Бирюзовое озеро';
    const ringY=(x,z)=>Math.sqrt(waterRadius**2-x*x-z*z)-waterRadius;
    const pads=[];
    for(const [index,[x,z,s,bloom]] of [[-.84,.23,1.12,'#e8a366'],[-.71,.43,.96,0],[.79,-.34,1.12,'#e4a1ac'],
      [.59,.50,1.07,'#d8889d'],[.76,.32,.93,0],[.43,.72,.91,'#efd67e'],[-.57,.57,1.04,0],[-.36,.744,.81,'#f2ca71'],
      [.30,-.69,.87,0],[-.74,-.33,1.08,'#e1a4ba'],[.47,-.60,.76,0],[.09,.79,.62,0]].entries()) {
      const y=ringY(x,z)+.019;
      const pad=new Group();
      pad.position.set(x,y,z);
      pad.rotation.set(z/waterRadius,x*2.3,-x/waterRadius);
      waterRoot.add(pad);
      const tint=index%3===0?'#b9ca65':index%3===1?'#84b06d':'#a1c46e';
      const surfaceLeaf=model(pad,leaf,tint,[0,0,0],[.152*s,1,.146*s]);
      surfaceLeaf.castShadow=false;
      if(bloom) {
        for(let i=0;i<6;i++) {
          const a=i*Land.tau/6;
          model(pad,'tiny',bloom,[.041*Math.cos(a),.039,.041*Math.sin(a)],[.047,.024,.027],[.19,-a,-.26]);
        }
        model(pad,'tiny','#f5d282',[0,.057,0],[.029,.021,.027]);
      }
      batchRepeatedParts(pad);
      pads.push({pad,y,angle:x*2.3});
    }
    const batch=makeDecoration(world,frameAt);
    for(const [k,pool] of pools.entries()) {
      for(let i=0;i<(mini?16:27);i++) {
        if(k===0 && i%5===1) continue;
        const a=i*2.399;
        const p=local(pool,Math.cos(a)*pool.width*(1.10+(i%3)*.054),Math.sin(a)*pool.depth*(1.13+(i%3)*.063));
        if(margin(Land.direction(p.lon,p.lat))<.028) continue;
        batch.positionAt(p.lon,p.lat,-.028,a,.69+(i%7)*.076);
        batch.add('pebble',i%2?'#a5aea2':'#829989',[0,.052,0],[.19,.125,.162],[.2,0,-.17],!mini);
        if(i%3===0) {
          batch.add('pebble','#9fb373',[.02,.116,.032],[.13,.076,.106],null,false);
          for(let j=0;j<4;j++) batch.add('tiny','#8faa62',[.16,.11,.056*j-.055],[.024,.136,.020],[0,j*.9,-.32+.16*j],false);
        }
      }
    }
    for(const [i,[x,z,w,h,d]] of [[.97,.80,.34,.24,.24],[1.15,.66,.23,.20,.24],[-.78,.86,.31,.23,.27],
      [-1.09,-.51,.26,.27,.24],[1.23,-.36,.32,.24,.25],[.50,-1.08,.29,.23,.20]].entries()) {
      const p=local(pools[0],x,z);
      batch.positionAt(p.lon,p.lat,.013,i*.73);
      batch.add('pebble','#a3ada5',[0,.066,0],[w,h,d],[.19,.37,-.13],!mini);
      batch.add('pebble','#8a9b80',[w*.37,.131,-d*.26],[w*.68,h*.54,d*.58],[0,.9,.21],false);
      for(let j=0;j<4;j++) {
        const height=.13+j%3*.048;
        batch.add('stem','#7b9d67',[w*.6+j*.043,height*.52,d*.55],[.010,height,.011],[0,0,-.16+j*.1],false);
        batch.add('tiny','#b18f65',[w*.6+j*.046,height,d*.55],[.018,.034,.017],null,false);
      }
    }
    batch.commit();
    const shoreStart=local(pools[0],-1.58,.10),shoreEnd=local(pools[0],-1.04,.15);
    Landforms.boardwalk(world,surface,{start:shoreStart,end:shoreEnd,curve:0});

    const falls=Landforms.place(world,surface,spring,.019,.21);
    falls.name='Ручей через каменные ступени';
    const rows=[[-.37,.42,.20],[-.13,.38,.24],[.075,.24,.28],[.255,.205,.27],
      [.355,-.015,.23],[.50,-.18,.29],[.71,-.265,.35],[.82,-.279,.41]];
    for(const [i,[z,y,width]] of rows.entries()) {
      if(i===rows.length-1) continue;
      for(const side of [-1,1]) {
        model(falls,'pebble',i%2?'#97a69a':'#808f83',[side*(width*.5+.102),y-.119,z],
          [.169,.173,.157],[.12,i*.73,side*.17]);
        if(i%3===0) model(falls,'pebble','#83a76d',[side*(width*.5+.136),y+.019,z-.016],[.130,.062,.118]);
      }
    }
    const vertices=[],indexes=[];
    for(const [i,[z,y,w]] of rows.entries()) {
      vertices.push(-w/2,y,z,w/2,y-.007,z+.012);
      if(i) indexes.push(i*2-2,i*2-1,i*2,i*2-1,i*2+1,i*2);
    }
    const flowGeo=new THREE.BufferGeometry();
    flowGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    flowGeo.setIndex(indexes);
    flowGeo.computeVertexNormals();
    falls.add(new Mesh(flowGeo,new THREE.MeshStandardMaterial({color:'#72c6bd',emissive:'#2f827e',emissiveIntensity:.12,side:THREE.DoubleSide,roughness:.58})));
    batchRepeatedParts(falls);
    if(mini) return;
    const ribbons=Array.from({length:9},()=>model(falls,'tiny','#d1ece0',[0,0,0],[.014,.013,.072]));
    for(const ribbon of ribbons) ribbon.castShadow=false;
    return (seconds)=>{
      for(const [i,{pad,y,angle}] of pads.entries()) {
        pad.position.y=y+.009*Math.sin(seconds*1.5+i*1.74);
        pad.rotation.y=angle+.086*Math.sin(seconds*.64+i);
      }
      for(const [i,ribbon] of ribbons.entries()) {
        const t=(seconds*.70+i/ribbons.length)%1*(rows.length-1);
        const index=Math.floor(t),blend=t-index;
        const [z,y]=rows[index],[nextZ,nextY]=rows[index+1];
        ribbon.position.set(.057*(i%3-1),lerp(y,nextY,blend)+.013,lerp(z,nextZ,blend));
        ribbon.rotation.x=-Math.atan2(nextY-y,nextZ-z);
      }
    };
  }

  function sheep(world,size,coat) {
    const base=new Group();
    base.scale.setScalar(size);
    world.add(base);
    const body=new Group();
    base.add(body);
    const legs=[];
    for(const x of [-.090,.090]) for(const z of [-.128,.127]) {
      const leg=new Group();
      leg.position.set(x,.177,z);
      body.add(leg);
      legs.push(leg);
      model(leg,'stem','#6b655e',[0,-.060,0],[.024,.145,.026]);
      model(leg,'round','#565956',[0,-.132,.013],[.034,.038,.043]);
    }
    model(body,'pebble',coat,[0,.229,-.024],[.173,.136,.221]);
    for (const [i,[x,y,z]] of [[.091,.264,.063],[-.099,.264,.053],[.104,.249,-.09],[-.102,.269,-.107],
      [0,.313,.063],[.008,.314,-.093],[0,.250,-.181]].entries()) {
      model(body,'pebble',i%4===0?'#e8ddc2':coat,[x,y,z],[.105,.109,.116],[0,i*.48,.34]);
    }
    model(body,'round',coat,[0,.233,-.235],[.057,.058,.057]);
    const head=new Group();
    head.position.set(0,.25,.162);
    body.add(head);
    model(head,'round','#77716c',[0,0,.056],[.085,.090,.103]);
    model(head,'tiny',coat,[.006,.065,.046],[.080,.049,.078]);
    model(head,'tiny','#a39487',[0,-.033,.127],[.056,.041,.043]);
    const ears=[];
    for(const side of [-1,1]) {
      ears.push(model(head,'tiny','#89827d',[side*.091,.032,.052],[.066,.025,.037],[0,side*.22,side*-.35]));
      model(head,'tiny','#3e4944',[side*.040,.018,.128],[.013,.015,.010]);
    }
    batchRepeatedParts(body,head);
    function pose(t,walk,bend,alert,rest=0) {
      const gait=Math.sin(t*10)*walk;
      body.position.y=.021*Math.abs(gait)-rest*.108;
      for(const [i,leg] of legs.entries()) leg.rotation.x=gait*(i===0||i===3?.56:-.56)+(i%2?-.94:.91)*rest;
      head.rotation.x= .87*bend-.34*alert+.055*Math.sin(t*4.6)*(bend+.2);
      for(const [i,ear] of ears.entries()) ear.rotation.z=(i?1:-1)*(-.38+.93*alert+.095*Math.sin(t*5+i));
    }
    return {base,pose};
  }

  function fold(world,mini) {
    const fence=makeDecoration(world,frameAt);
    const row=[[-.45,.62],[-.47,.39],[-.45,.15],[-.42,-.10],[-.38,-.34],[-.14,-.42],
      [.12,-.43],[.37,-.42],[.67,-.42],[.80,.083],[.80,.29],[.76,.54],[.53,.62],[.29,.64]];
    for(const [i,[x,z]] of row.entries()) {
      const p=local(pasture,x,z);
      fence.positionAt(p.lon,p.lat,-.014,0);
      fence.add('box','#9a7b59',[0,.137,0],[.044,.30,.047],[0,0,i%3*.039],!mini);
      if(i===8 || i===row.length-1) continue;
      const [nextX,nextZ]=row[i+1];
      const mid=local(pasture,(x+nextX)/2,(z+nextZ)/2);
      fence.positionAt(mid.lon,mid.lat,-.015,Math.atan2(nextX-x,nextZ-z));
      for(const y of [.097,.218]) fence.add('box','#b39169',[0,y,0],[.030,.042,Math.hypot(nextX-x,nextZ-z)+.01],null,!mini);
    }
    fence.commit();
    const gate=Landforms.place(world,surface,local(pasture,-.075,.633),-.006);
    gate.name='Колокол у выгона';
    for(const side of [-1,1]) model(gate,'box','#92745b',[side*.225,.285,0],[.057,.58,.058]);
    model(gate,'box','#b08e6b',[0,.563,0],[.538,.070,.083]);
    const brass=new Group();
    brass.position.y=.532;
    gate.add(brass);
    const bellShape=new THREE.LatheGeometry([
      new Vector2(.0,-.100),new Vector2(.088,-.100),new Vector2(.081,-.080),new Vector2(.052,-.040),new Vector2(.036,0),new Vector2(0,.017)
    ],13);
    model(brass,bellShape,'#dfb575',[0,-.018,0],[1,1,1]);
    model(brass,'tiny','#866747',[0,-.127,0],[.023,.030,.021]);
    const trough=Landforms.place(world,surface,local(pasture,.43,.03),.016,.73);
    model(trough,'box','#9a826b',[0,.081,0],[.383,.155,.166]);
    model(trough,'box','#83b3aa',[0,.167,0],[.334,.019,.123]);
    for(const x of [-.171,.171]) model(trough,'box','#b49b7e',[x,.183,0],[.046,.053,.181]);

    const herd=(mini?[1,.69]:[1,.86,.75,.95,.63,.78]).map((size,i)=>sheep(world,size,i%3?'#f2e7cf':'#e8dfcf'));
    const keeper=!mini&&Inhabitants.resident(world,'gardener',1.07);
    if(keeper) {
      keeper.base.name='Пастух';
      model(keeper.hands[1],'stem','#876951',[.021,.209,.038],[.019,.636,.019],[.10,0,-.10]);
      model(keeper.hands[1],'ring','#a0825f',[.028,.512,.040],[.057,.054,.041],[0,0,-.32]);
    }
    let lastCall=-Infinity;
    const trailPoint=new Vector2(), tangent=new Vector2();
    function walkAlong(base,u,lane=0) {
      const time=herdTrail.getUtoTmapping(u);
      herdTrail.getPoint(time,trailPoint);
      herdTrail.getTangent(time,tangent);
      const lon=trailPoint.x+tangent.y*lane,lat=trailPoint.y-tangent.x*lane;
      const {position,rotation}=frameAt(lon,lat,.012);
      base.position.copy(position);
      base.quaternion.copy(rotation);
      base.rotateY(Math.atan2(tangent.x*Math.cos(lat),-tangent.y));
    }
    for(const [i,animal] of herd.entries()) animal.base.name=i===4?'Ягненок':'Овца '+(i+1);
    function animate(seconds) {
      const phase=(seconds+1.4)%34;
      const traveled=.30*smoothstep(phase,0,9.8)+.26*smoothstep(phase,11.9,19.6)+.44*smoothstep(phase,22.3,34);
      const walk=1-(smoothstep(phase,8.9,9.8)-smoothstep(phase,11.9,12.4))-(smoothstep(phase,18.6,19.6)-smoothstep(phase,22.3,22.9));
      const echo=seconds-lastCall;
      const alert=echo>=0&&echo<4 ? (1-smoothstep(echo,1.05,3.8))*smoothstep(echo,0,.18) : 0;
      brass.rotation.z=echo>=0&&echo<4 ? Math.sin(echo*15)*Math.exp(-echo*1.52)*.53 : 0;
      for(const [i,animal] of herd.entries()) {
        const u=THREE.MathUtils.euclideanModulo(traveled+.066+i*.057,1);
        walkAlong(animal.base,u,(i%3-1)*.035);
        const bend=(1-walk)*.76+.16*(1+Math.sin(seconds*1.6+i*2));
        animal.pose(seconds+i*.53,walk*.70,bend*(1-alert),alert);
      }
      if(keeper) {
        walkAlong(keeper.base,THREE.MathUtils.euclideanModulo(traveled+.39,1),-.022);
        keeper.pose(seconds,walk*.82,.20+.29*alert);
      }
    }
    animate(5.5);
    let audio;
    function trigger(seconds) {
      lastCall=seconds;
      const Audio=globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if(!Audio) return;
      audio ??= new Audio();
      if(audio.state==='suspended') audio.resume().catch(()=>{});
      const start=audio.currentTime;
      for(const [pitch,volume,decay] of [[683,.034,.47],[1198,.015,.29],[1846,.009,.16]]) {
        const tone=audio.createOscillator(), ring=audio.createGain();
        tone.frequency.value=pitch;
        ring.gain.setValueAtTime(volume,start);
        ring.gain.exponentialRampToValueAtTime(.0001,start+decay);
        tone.connect(ring).connect(audio.destination);
        tone.start(start);
        tone.stop(start+decay);
      }
    }
    return {animate:mini?()=>{}:animate,trigger};
  }

  function stoneArch(world,mini) {
    const root=Landforms.place(world,surface,arch,.006,-.37);
    root.name='Каменные ворота';
    for(const side of [-1,1]) {
      for(let i=0;i<4;i++) {
        const x=side*(.54-i*.078),y=.083+i*.211;
        model(root,'pebble',i%2?'#9caaa0':'#7c9487',[x,y,-.014*i],[.235,.208,.246],[.07,i*.68,side*.21]);
        if(i>0) model(root,'pebble','#95aa72',[x,y+.149,-.026],[.160,.069,.181]);
      }
    }
    model(root,'pebble','#a8ad9c',[0,.851,-.055],[.356,.143,.245],[.2,.1,.06]);
    model(root,'pebble','#8ba66e',[.047,.978,-.048],[.285,.059,.194]);
    for(let i=0;i<5;i++) model(root,'pebble','#b2b2a0',[.082*Math.sin(i),.014,.20+i*.145],[.122,.035,.058],[0,i*.8,0]);
    const lamp=Landforms.lamp(root,-.731,.023,.18,true);
    batchRepeatedParts(root);
    const lamb=sheep(world,.68,'#e8dec8');
    lamb.base.name='Ягненок за каменными воротами';
    const bed=local(arch,.56,-.52);
    lamb.base.position.copy(point(bed.lon,bed.lat,.012));
    lamb.base.quaternion.copy(frameAt(bed.lon,bed.lat).rotation);
    lamb.base.rotateY(.68);
    lamb.pose(0,0,.55,0,1);
    return (seconds,night)=>{
      lamp(seconds,night);
      if(!mini) lamb.pose(seconds*.64,0,.55+.15*Math.sin(seconds*.4),0,1);
    };
  }

  function create(mini=false) {
    const group=new Group();
    const water=ground(group,mini);
    plants(group,mini);
    hillTrail(group,mini);
    const home=chalet(group,mini);
    const cascade=lakeside(group,mini);
    const flock=fold(group,mini);
    const glade=stoneArch(group,mini);
    const pigs=CloverWallow.create(group,surface,mini);
    const hay=CloverHay.create(group,surface,mini);
    const fauna=CloverFauna.create(group,surface,mini);
    const butterflies=mini?null:Scenery.butterflies(group,[[-.53,.31],[.28,.56],[.51,-.32],[-.67,-.21],[.98,.52],
      [-2.56,.39],[-2.43,-.49],[2.11,-.14],[1.53,.32],[-1.04,-.48],[-1.79,-.37],[2.55,.86],[-2.82,.91],[.48,-1.13]],
      frameAt,['#e8a868','#b68ccf','#e5a0a2','#e3de8d','#85c6bd','#efdde2','#94a4da']);
    if(mini) group.traverse(part=>{part.castShadow=false;part.receiveShadow=false;});
    return {group,trigger:flock.trigger,animate(seconds,night) {
      water.value=seconds;
      home(seconds,night);
      cascade?.(seconds);
      flock.animate(seconds);
      glade(seconds,night);
      pigs?.(seconds,night);
      hay?.(seconds,night);
      fauna?.(seconds,night);
      butterflies?.(seconds);
    }};
  }

  return {create,view,pasture,stops};
})();

;
const PondInsects=(()=>{
  const {Color,Group,Vector3}=THREE;
  const {smoothstep,euclideanModulo}=THREE.MathUtils;
  const {model,makeDecoration,batchRepeatedParts}=Scenery;
  const site={lon:1.31,lat:.665};
  const stop={label:'Apiary',...site,zoom:.65,tilt:.15};

  function at(x,z) {
    return {lon:site.lon+x/(Land.radius*Math.cos(site.lat)),lat:site.lat-z/Land.radius};
  }

  function reserve(lon,lat) {
    const x=euclideanModulo(lon-site.lon+Math.PI,Land.tau)-Math.PI;
    return Math.hypot(x*Math.cos(site.lat),lat-site.lat)<.163;
  }

  function apiary(world,surface,mini) {
    const hives=[];
    const flowers=[];
    const patch=makeDecoration(world,surface.frameAt);
    for(const [i,[x,z]] of [[-.56,.19],[-.23,.45],[.37,.43],[.64,.26],[.70,-.11],[-.68,-.42]].entries()) {
      const p=at(x,z);
      if(surface.margin(p.lon,p.lat)<.066) continue;
      flowers.push(surface.point(p.lon,p.lat,.121));
      patch.positionAt(p.lon,p.lat,-.007,i*.53);
      patch.add('pebble','#91aa74',[0,.060,.02],[.139,.099,.124],[.10,.3,-.16],false);
      for(let j=0;j<(mini?3:6);j++) {
        const a=j*2.399,h=.107+j%3*.039;
        const x=.117*Math.cos(a),z=.102*Math.sin(a);
        patch.add('stem','#769359',[x,h*.5,z],[.012,h,.012],null,false);
        for(let k=0;k<4;k++) {
          const b=k*Land.tau/4;
          patch.add('tiny',i%2?'#e5ca86':'#ba9dc9',[x+.027*Math.cos(b),h,z+.027*Math.sin(b)],
            [.027,.017,.020],[0,-b,0],false);
        }
        patch.add('tiny','#dcb86e',[x,h+.014,z],[.016,.012,.016],null,false);
      }
    }
    patch.commit();
    for(const [i,[x,z,yaw]] of [[-.36,-.12,-.20],[.082,-.18,.035],[.46,-.24,.22]].entries()) {
      const hive=Landforms.place(world,surface,at(x,z),.014,yaw);
      hive.name=`Улей ${i+1}`;
      const tones=[['#b39c69','#d1b579'],['#8fa496','#aabdae'],['#bf967d','#d0ab89']][i];
      for(const side of [-1,1]) model(hive,'box','#8d785d',[side*.102,.065,0],[.041,.134,.259]);
      for(let tier=0;tier<3;tier++) model(hive,'box',tones[tier%2],[0,.123+.081*tier,0],[.265,.079,.263]);
      model(hive,'box','#7d6c56',[0,.127,.134],[.109,.031,.021]);
      model(hive,'box','#bd9c68',[0,.096,.176],[.148,.020,.079]);
      for(const side of [-1,1]) model(hive,'box',i%2?'#739284':'#8a8e69',
        [side*.077,.354,0],[.188,.048,.326],[0,0,side*-.34]);
      model(hive,'box','#9e956e',[0,.386,0],[.058,.038,.330]);
      hives.push(hive.position.clone().add(new Vector3(0,.132,.147).applyQuaternion(hive.quaternion)));
      batchRepeatedParts(hive);
    }
    return {hives,flowers};
  }

  function bees(world,hives,flowers) {
    const count=8;
    const bodyGeometry=new THREE.SphereGeometry(1,7,5);
    const dark=new THREE.InstancedMesh(bodyGeometry,new THREE.MeshStandardMaterial({color:'#493f36',roughness:.95}),count);
    const gold=new THREE.InstancedMesh(bodyGeometry,new THREE.MeshStandardMaterial({color:'#e4b65f',roughness:.86}),count*2);
    const wings=new THREE.InstancedMesh(bodyGeometry,
      new THREE.MeshBasicMaterial({color:'#eee7ba',transparent:true,opacity:.68,depthWrite:false}),count*2);
    for(const [mesh,name] of [[dark,'Пчелы на пасеке'],[gold,'Золотые полоски пчел'],[wings,'Крылья пчел']]) {
      mesh.name=name;
      mesh.frustumCulled=false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      world.add(mesh);
    }
    const part=new THREE.Object3D(), frame=new THREE.Object3D(), offset=new Vector3(), up=new Vector3(), heading=new Vector3();
    return (seconds,night)=>{
      const day=1-smoothstep(night,.26,.81);
      for(const mesh of [dark,gold,wings]) mesh.visible=day>.035;
      if(day<=.035) return;
      for(let i=0;i<count;i++) {
        const nest=hives[i%hives.length], target=flowers[(i*5+1)%flowers.length];
        const t=(seconds*(.088+i*.0024)+i*.372)%1;
        const travel=(smoothstep(t,.025,.36)-smoothstep(t,.66,.98))*day;
        const a=seconds*7.4+i*3.15;
        const airborne=Math.sin(Math.PI*travel);
        up.copy(nest).normalize();
        frame.position.copy(nest).lerp(target,travel).addScaledVector(up,.23*airborne+.044*Math.sin(a*.61)*travel);
        frame.position.add(offset.set(.035*Math.sin(a)*travel,0,.041*Math.cos(a)*travel));
        heading.copy(target).sub(nest).multiplyScalar(t>.65?-1:1).add(offset.set(.08*Math.cos(a),0,.067*Math.sin(a)));
        frame.quaternion.copy(Landforms.walkingFrame(frame.position,heading));
        const presence=smoothstep(t,.011,.072)*(1-smoothstep(t,.94,.999))*day;
        frame.scale.setScalar(presence);
        frame.updateMatrix();
        part.position.set(0,0,0);
        part.scale.set(.014,.014,.029);
        part.rotation.set(0,0,0);
        part.updateMatrix();
        dark.setMatrixAt(i,part.matrix.premultiply(frame.matrix));
        for(let j=0;j<2;j++) {
          part.position.set(0,0,-.009+j*.016);
          part.scale.set(.015,.0145,.0061);
          part.updateMatrix();
          gold.setMatrixAt(i*2+j,part.matrix.premultiply(frame.matrix));
        }
        for(let j=0;j<2;j++) {
          const side=j?1:-1;
          part.position.set(side*.015,.012,.006);
          part.rotation.set(.10,side*.49,side*Math.sin(seconds*64+i)*.74);
          part.scale.set(.020,.0025,.010);
          part.updateMatrix();
          wings.setMatrixAt(i*2+j,part.matrix.premultiply(frame.matrix));
        }
      }
      for(const mesh of [dark,gold,wings]) mesh.instanceMatrix.needsUpdate=true;
    };
  }

  function gnats(world,surface) {
    const lon=2.82,{center,width}=surface.river(lon);
    const swarms=[{lon:.45,lat:-.499},{lon,lat:center-width*.57}].map(({lon,lat})=>{
      const frame=surface.frameAt(lon,lat);
      frame.position.setLength(Math.max(frame.position.length(),Land.radius+Land.waterLevel)+.113);
      return frame;
    });
    const amount=12;
    const insects=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),
      new THREE.MeshBasicMaterial({color:'#c2ba9d'}),amount*swarms.length);
    insects.name='Рои комаров у воды';
    insects.frustumCulled=false;
    insects.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.add(insects);
    const particle=new THREE.Object3D();
    return (seconds,night)=>{
      const dusk=smoothstep(night,.25,.65);
      for(const [index,{position,rotation}] of swarms.entries()) for(let i=0;i<amount;i++) {
        const a=seconds*(2.8+i%4*.39)+i*2.399+index*3;
        const radius=.053+i%5*.033+.025*Math.cos(a*.59);
        const scale=(i%4===0?.42:0)+(i%4===0?.58:1)*dusk;
        particle.position.set(Math.cos(a)*radius,.063+.054*Math.sin(a*1.30)+.031*Math.sin(a*.51),
          Math.sin(a)*radius*.78).applyQuaternion(rotation).add(position);
        particle.scale.set(.0043*scale,.0081*scale,.0049*scale);
        particle.updateMatrix();
        insects.setMatrixAt(index*amount+i,particle.matrix);
      }
      insects.instanceMatrix.needsUpdate=true;
    };
  }

  function create(world,surface,mini) {
    const {hives,flowers}=apiary(world,surface,mini);
    if(mini) return;
    const forage=bees(world,hives,flowers);
    const hover=gnats(world,surface);
    return (seconds,night)=>{
      forage(seconds,night);
      hover(seconds,night);
    };
  }

  return {stop,reserve,create};
})();

;
const Biomes = (() => {
  const { Color, Group, Mesh, MeshBasicMaterial, Vector3, Shape, ShapeGeometry } = THREE;
  const { model, makeDecoration, batchRepeatedParts } = Scenery;
  const { clamp, lerp, smoothstep } = THREE.MathUtils;
  const tau = Land.tau;
  const palette = {
    meadow: { ground: '#a6c65f', shade: '#76a65a', water: '#2c9dbd', trees: ['#78a84e','#94b458','#326c57'] },
    shore: { ground: '#e3bc6e', shade: '#b58952', water: '#9867a5', trees: ['#e7ae57','#f4cb69','#c68e49'] },
    pond: { ground: '#78a460', shade: '#415f53', water: '#288d91', trees: ['#507f60','#6f9d61','#376a59'] }
  };
  const view = {
    meadow: {lon: -.08, lat: .24},
    shore: {lon: -.09, lat: .13},
    pond: {lon: .04, lat: .18},
    clover: Clover.view
  };
  const places = {
    meadow: Land.districts.meadow,
    shore: ShoreLife.cove,
    pond: {lon: -.19, lat: -.10},
    clover: Clover.pasture
  };

  function groupAt(frameAt, lon, lat, offset = 0, yaw = 0) {
    const {position, rotation} = frameAt(lon, lat, offset);
    const region = new Group();
    region.position.copy(position);
    region.quaternion.copy(rotation);
    region.rotateY(yaw);
    return region;
  }

  function defineSurface(kind) {
    if (kind === 'meadow') {
      return {margin: Land.surface, frameAt: Land.frame, point: Land.point};
    }
    const wrap = (lon) => THREE.MathUtils.euclideanModulo(lon + Math.PI, tau) - Math.PI;
    function river(lon) {
      const bend = smoothstep(Math.abs(wrap(lon)), .72, 1.52);
      const center = .26*Math.sin(lon) + .055*Math.sin(2*lon)
        + bend*(.15*Math.sin(3*lon+.55)+.045*Math.sin(5*lon-.45));
      const width = bend*(.077+.023*Math.sin(3*lon+.8)+.015*Math.cos(5*lon));
      return {center,width};
    }
    function margin(lon, lat) {
      if (kind === 'shore') return Math.max(Landforms.shoreMargin(lon,lat),Landmarks.lagoonMargin(lon,lat));
      const x = wrap(lon - .08) / .78;
      const y = (lat + .14) / .51;
      const lake = (Math.hypot(x,y) - 1 + .075 * Math.cos(Math.atan2(y,x)*5)) * .51;
      // Integer harmonics meet at the back of the sphere without a jump in the riverbed.
      const {center,width} = river(lon);
      const creek = Math.abs(lat-center)-width;
      return Math.min(lake, creek);
    }
    function point(lon, lat, offset = 0) {
      const normal = Land.direction(lon,lat);
      const shore = margin(lon,lat);
      const {x,y,z} = normal;
      const lumps = Math.cos(x*7 + y*5) * Math.sin(z*12 - y*8) * .065
        + Math.sin(x*13 - y*12 + z*9) * .029;
      const polarFade = 1-smoothstep(Math.abs(lat),1.02,1.49);
      let hill = .19+.13*Math.cos(lon*2+.8)**2*smoothstep(lat,.13,.62)*polarFade;
      if (kind === 'pond') {
        const {center,width} = river(lon);
        const ravine = smoothstep(Math.abs(wrap(lon)),.97,1.75);
        const higherBank = lat > center ? .66+.30*Math.sin(2*lon+.8) : .55-.35*Math.sin(2*lon+.8);
        hill = .20 + .35*Math.exp(-((wrap(lon-.52)/.39)**2+((lat-.48)/.26)**2))
          + ravine*higherBank*.45*smoothstep(Math.abs(lat-center)-width,.06,.19)
            *(1-smoothstep(Math.abs(lat-center)-width,.24,.44));
      }
      const landmark = Landmarks.relief(kind,lon,lat);
      const relief = kind==='shore' ? landmark*polarFade+ShoreLife.ridgeHeight(normal) : landmark;
      const elevation = lerp(-.16,hill+lumps+relief,smoothstep(shore,-.035,.135));
      return normal.multiplyScalar(Land.radius+elevation+offset);
    }
    function frameAt(lon,lat,offset=0) {
      return {...Land.frame(lon,lat), position:point(lon,lat,offset)};
    }
    return { margin, frameAt, point, river };
  }

  function terrain(world, kind, surface, miniature) {
    const config = palette[kind];
    const grass = new Color(config.ground), shade = new Color(config.shade);
    const coast = new Color(kind === 'shore' ? '#e9c58a' : '#93b885');
    const sandstone = new Color('#b99673'), paleStone = new Color('#e4c291');
    const relief = Land.globeGeometry(miniature ? 56 : 160, miniature ? 28 : 84, (lon,lat) => {
      const position = surface.point(lon,lat);
      const normal = Land.direction(lon,lat);
      const {x,y,z} = normal;
      const fleck = .48 + Math.sin(x*21+y*18-z*5) * Math.cos(z*20-y*8) * .13
        + Math.sin(x*5-z*8+y*6) * .24 + Math.sin(x*12+y*13+z*7) * .06;
      const color = shade.clone().lerp(grass,clamp(fleck,0,1));
      if (kind==='shore') {
        const rising = ShoreLife.ridgeHeight(normal);
        const strata = .56+.19*Math.sin(rising*43+x*15-y*11)+.17*Math.sin(z*26+y*31);
        color.lerp(sandstone.clone().lerp(paleStone,strata),smoothstep(rising,.24,.70)*.85);
      }
      color.lerp(coast, (1-smoothstep(surface.margin(lon,lat),.02,.10)) * (kind === 'shore' ? .75 : .23));
      return {color,position};
    });
    const ground = new Mesh(relief,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
    ground.receiveShadow = !miniature;
    world.add(ground);
    const waterMaterial = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62});
    const waterLevel = Land.radius+Land.waterLevel;
    const deep = new Color(config.water);
    const shoal = new Color(kind==='shore' ? '#ca9caf' : '#6fbaa7');
    const foam = new Color(kind==='shore' ? '#f1d1ba' : '#c4e3c0');
    const waterGeometry = Land.globeGeometry(miniature ? 56 : 160,miniature ? 28 : 84,(lon,lat) => {
      const bank=surface.margin(lon,lat);
      const color=deep.clone().lerp(shoal,(1-smoothstep(-bank,.012,.18))*.81);
      const edge=Math.abs(surface.point(lon,lat).length()-waterLevel);
      color.lerp(foam,(1-smoothstep(edge,.012,.052))*.47);
      return {color,position:Land.direction(lon,lat).multiplyScalar(waterLevel)};
    });
    const time = { value: 0 };
    if (!miniature) {
      waterMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uCurrent = time;
        shader.vertexShader = 'varying vec3 vPond;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>', '#include <begin_vertex>\nvPond = position;'
        );
        shader.fragmentShader = 'varying vec3 vPond; uniform float uCurrent;\n' + shader.fragmentShader.replace(
          '#include <color_fragment>', `#include <color_fragment>
          float band = sin(vPond.y*26.0 + vPond.z*9.0 + sin(vPond.x*7.0)*.72 - uCurrent*.92);
          float spots = sin(vPond.x*18.0 + vPond.z*12.0 - uCurrent*.41) + sin(vPond.y*13.0 - vPond.x*25.0);
          float sheen = smoothstep(.84,.99,band) * smoothstep(.28,1.3,spots);
          diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.64,.89,.85),sheen*.17);
          diffuseColor.rgb *= .94 + .09*cos(vPond.y*9.0-vPond.z*5.0);`
        );
      };
    }
    const water = new Mesh(waterGeometry, waterMaterial);
    water.receiveShadow = !miniature;
    world.add(water);
    return time;
  }

  function vegetation(world, kind, surface, miniature) {
    const random = Land.rng({meadow:41312,shore:172041,pond:72621}[kind]);
    const {positionAt,add,commit} = makeDecoration(world,surface.frameAt);
    const colors = palette[kind].trees;
    const pick = (list) => list[Math.floor(random()*list.length)];
    const sites = kind === 'shore' ? [
      [-.62,.49,1.22],[-.46,.58,.93],[-.69,.73,.84],[.57,.43,1.14],[.63,.59,.85],[.46,.62,.99],[.22,.83,.71],[-.27,.86,.78]
    ] : kind === 'pond' ? [
      [-.80,.43,1.05],[-.60,.69,1.12],[-.68,.53,.92],[.65,.65,1.2],[.80,.50,1.02],
      [1.11,.29,1.09],[-.93,-.09,.88],[.91,-.47,.82],[-.36,.87,.85],[.25,.96,.76]
    ] : [[-.96,.66,1],[-.80,.77,.74],[.72,.70,1.10],[.98,.42,.87],[-.91,-.47,.81],[.71,-.72,.86]];
    const attempts = miniature ? 42 : 118;
    for (let i = 0; i < attempts; i++) {
      const lon = random()*tau - Math.PI;
      const lat = Math.asin(random()*2-1);
      if (surface.margin(lon,lat) < .12 || Landforms.reserve(kind,lon,lat) || Landmarks.reserve(kind,lon,lat)) continue;
      if (sites.some(([x,y]) => Math.hypot(x-lon,y-lat)<.18)) continue;
      sites.push([lon,lat,.46+random()*.54]);
    }
    for (const [lon,lat,size] of sites) {
      if (surface.margin(lon,lat) < .061 || Landforms.reserve(kind,lon,lat) || Landmarks.reserve(kind,lon,lat)) continue;
      positionAt(lon,lat,-.03,random()*tau,size);
      add('stem','#845e47',[0,.39,0],[.115,.86,.115],[0,0,-.12],!miniature);
      const narrow = kind === 'shore' || random() > .64;
      for (let i = 0; i < (miniature ? 4 : 6); i++) {
        const a = i * 2.399;
        const radius = narrow ? .30 - i*.027 : .38;
        const y = narrow ? .61 + i*.234 : .97 + random()*.43;
        const spread = narrow ? .15 : .39;
        add('pebble',pick(colors),[Math.cos(a)*spread,y,Math.sin(a)*spread],
          [radius,narrow ? radius * 2.1 : .43,radius*.91],[0,a,.13],!miniature);
      }
    }
    const count = miniature ? 90 : 405;
    for (let i = 0; i < count; i++) {
      const lon = random()*tau - Math.PI;
      const lat = Math.asin(random()*2-1);
      if (surface.margin(lon,lat) < .023 || Landforms.reserve(kind,lon,lat) || Landmarks.reserve(kind,lon,lat)) continue;
      positionAt(lon,lat,-.015,random()*tau,.52+random()*.70);
      if (i % 3 === 0) {
        add('pebble',pick(colors),[0,.065,0],[.24,.15,.19],null,!miniature);
        add('pebble',kind==='shore'?'#b98d6c':'#9caa86',[.22,.04,.04],[.12,.085,.126],null,false);
        continue;
      }
      const petal = pick(kind === 'shore' ? ['#b28cc8','#ffe38c','#f4ae78','#ebc4d7'] : ['#f3d881','#d5e6b0','#a3b8e7','#ecd4c8']);
      for (let j = 0; j < 3; j++) {
        const x = (j-1)*.083, height = .12 + random()*.17;
        add('stem', '#6d884e',[x,height*.5,0],[.012,height,.012],null,false);
        add('round', petal,[x,height,0],[.039,.026,.038],null,false);
      }
    }
    const insectSites = [];
    if (!miniature && kind !== 'meadow') {
      const patches = kind === 'shore'
        ? [[-2.19,.64],[-2.9,.47],[-2.35,.98],[-1.76,.48],[-1.08,.38],[-.45,.32],[.5,.41],[-.72,-1.04],[.50,-1.07],[2.72,.20]]
        : [[-2.35,-.81],[-2.96,-.59],[-2.52,-.40],[2.04,.65],[2.70,.61],[1.24,.48],[-.82,.18],[1.78,-.44],[-.94,-.52]];
      for (const [lon,lat] of sites) {
        if (random()<.34) patches.push([lon,lat]);
      }
      for (const [index,[lon,lat]] of patches.entries()) {
        let planted = 0;
        for (let i=0;i<20;i++) {
          const angle = random()*tau, spread = .025+.13*Math.sqrt(random());
          const x = lon+Math.cos(angle)*spread/Math.max(.3,Math.cos(lat)), y = clamp(lat+Math.sin(angle)*spread,-1.52,1.52);
          if (surface.margin(x,y)<.035 || Landforms.reserve(kind,x,y) || Landmarks.reserve(kind,x,y)) continue;
          positionAt(x,y,-.010,angle,.64+random()*.63);
          for (let j=-1;j<=1;j++) {
            add('tiny',pick(kind==='shore'?['#b8ae62','#d3c277','#8d9d58']:['#8bb15f','#a9c77a','#608a56']),
              [j*.048,.075,j*.023],[.019,.09+random()*.082,.016],[0,0,-j*.44],false);
          }
          if (i%4===0) {
            add('pebble',pick(colors),[.01,.09,.08],[.19,.18,.15],null,false);
            add('pebble',pick(colors),[-.10,.091,.02],[.13,.145,.13],null,false);
          }
          if (i%3!==1) continue;
          const big = kind==='shore' && index%3===0;
          const h=.11+random()*(big?.32:.14), radius=big?.057:.03;
          const color = big ? pick(['#8a62aa','#a27dc2','#b07db4']) : kind==='pond' ? '#f5f0d9' : '#f0d390';
          add('stem','#71884d',[0,h*.5,0],[.013,h,.013],null,false);
          for (let k=0;k<5;k++) {
            const petal=k*tau/5;
            add('tiny',color,[Math.cos(petal)*radius,h,Math.sin(petal)*radius],[radius,.021,radius*.7],[0,-petal,0],false);
          }
          add('tiny','#efc478',[0,h+.013,0],[radius*.46,.016,radius*.46],null,false);
          if (++planted===2 && index%2===0) insectSites.push([x,y]);
        }
      }
    }
    commit();
    return insectSites;
  }

  const leafShape = new Shape();
  leafShape.moveTo(.02,0);
  for (let i = 0; i <= 17; i++) {
    const angle = .36 + i/17 * (tau-.72);
    leafShape.lineTo(Math.cos(angle),Math.sin(angle)*.86);
  }
  leafShape.closePath();
  const leafGeometry = new THREE.ExtrudeGeometry(leafShape,{
    depth:.035, bevelEnabled:true, bevelThickness:.018, bevelSize:.022, bevelSegments:1, steps:1, curveSegments:8
  });
  leafGeometry.rotateX(-Math.PI/2);
  const boatShape = new Shape();
  boatShape.moveTo(0,1);
  boatShape.quadraticCurveTo(.52,.53,.51,-.36);
  boatShape.quadraticCurveTo(.42,-.81,0,-.95);
  boatShape.quadraticCurveTo(-.42,-.81,-.51,-.36);
  boatShape.quadraticCurveTo(-.52,.53,0,1);
  const rim = new THREE.Path();
  rim.moveTo(0,.79);
  rim.quadraticCurveTo(-.39,.42,-.39,-.28);
  rim.quadraticCurveTo(-.30,-.68,0,-.76);
  rim.quadraticCurveTo(.30,-.68,.39,-.28);
  rim.quadraticCurveTo(.39,.42,0,.79);
  boatShape.holes.push(rim);
  const hull = new THREE.ExtrudeGeometry(boatShape,{depth:.17,bevelEnabled:true,bevelThickness:.033,bevelSize:.031,bevelSegments:1,steps:1,curveSegments:7});
  hull.rotateX(-Math.PI/2);

  function lily(root, x, y, z, scale, angle, bloom = false) {
    const pad = new Group();
    pad.position.set(x,y,z);
    pad.rotateY(angle);
    pad.scale.setScalar(scale);
    root.add(pad);
    model(pad,leafGeometry, angle > 2 ? '#78a65b' : '#8fb665',[0,0,0],[1,1,1]);
    if (bloom) {
      for (let i = 0; i < 7; i++) {
        const a = i/7*tau;
        model(pad,'round',i%2?'#ffd8cb':'#efa9bf',
          [Math.cos(a)*.13,.09,Math.sin(a)*.13],[.14,.055,.073],[0,-a,.20]);
      }
      model(pad,'round','#f7d37a',[0,.12,0],[.095,.057,.090]);
    }
    return pad;
  }

  function rings(root, position, color, maxRadius) {
    const moving = new Group();
    moving.position.fromArray(position);
    root.add(moving);
    const rippleMaterial = new MeshBasicMaterial({color,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
    const ripple = new Mesh(new THREE.RingGeometry(.927,1,44), rippleMaterial);
    ripple.rotateX(-Math.PI/2);
    ripple.visible = false;
    moving.add(ripple);
    let start = -Infinity;
    return {
      trigger(seconds) { start = seconds; },
      update(seconds) {
        const t = (seconds - start)/1.36;
        ripple.visible = t >= 0 && t < 1;
        if (!ripple.visible) return;
        ripple.scale.setScalar(lerp(.12,maxRadius,t));
        rippleMaterial.opacity = Math.sin(Math.PI*t)*.68;
      }
    };
  }

  function latestEvent(seconds, time, period) {
    const start = time + Math.floor((seconds-time)/period)*period;
    return start < 0 ? -Infinity : start;
  }

  function shoreSet(root, mini, boatAnchor = root) {
    const narrow = boatAnchor === root;
    const waterRadius = Land.radius + Land.waterLevel;
    const anchorRadius = root.position.length();
    const waterY = (x,z) => Math.sqrt(waterRadius**2-x**2-z**2)-anchorRadius;
    const house = new Group();
    house.position.set(-.58,.01,-.22);
    house.rotation.y = -.12;
    root.add(house);
    model(house,'box','#ab775e',[0,.30,0],[.79,.59,.64]);
    model(house,'box','#84533e',[0,.18,.328],[.216,.36,.025]);
    model(house,'box','#eaba84',[.236,.35,.333],[.156,.192,.029]);
    const window = new THREE.MeshStandardMaterial({color:'#6d927c',emissive:'#ff9e58',emissiveIntensity:0,roughness:.64});
    model(house,'box',window,[.236,.35,.352],[.122,.153,.016]);
    for (const side of [-1,1]) {
      model(house,'box','#668674',[side*.240,.667,0],[.571,.097,.859],[0,0,-side*.87]);
      model(house,'box','#8ea082',[side*.243,.69,.43],[.586,.049,.063],[0,0,-side*.87]);
    }
    model(house,'stem','#ba8163',[-.233,.86,-.16],[.076,.35,.076]);
    model(house,'box','#864a47',[-.233,1.034,-.16],[.173,.063,.158]);
    model(house,'round','#ecd0ad',[0,.63,.384],[.12,.11,.052]);
    model(house,'round','#ac6b83',[0,.632,.428],[.061,.053,.019]);
    const deckColors = ['#a57452','#b78960','#be9168'];
    const planks = narrow ? 7 : 12;
    const dockEnd = .25 + (planks-2)*.105;
    for (let i = 0; i < planks; i++) {
      const z = .25 + i*.105;
      model(root,'box',deckColors[i%3],[-.47,.006-z*.10,z],[.88,.078,.097],[0,0,0]);
    }
    for (const [x,z] of [[-.86,.30],[-.09,.43],[-.86,dockEnd-.042],[-.09,dockEnd+.037]]) {
      const top = .137-z*.10;
      const foot = Math.min(-.18,waterY(x,z)-.07);
      model(root,'stem','#91674c',[x,(top+foot)*.5,z],[.052,top-foot,.052]);
    }
    for (let i = 0; i < 5; i++) {
      model(root,'pebble',i%2?'#d9a788':'#b7876d',
        [.02+.21*i,-.095,.55+.18*i],[.16,.14,.19],[0,i*.8,0]);
    }
    const boat = new Group();
    boat.name='Лодка у берега';
    const boatX = narrow ? .51 : 0, boatZ = narrow ? .83 : 0;
    const boatY = (narrow ? waterY(boatX,boatZ) : 0)+.025;
    const mooring = narrow ? 1.45 : -.36;
    boat.position.set(boatX,boatY,boatZ);
    if (narrow) boat.scale.setScalar(.83);
    boatAnchor.add(boat);
    model(boat,hull,'#935d49',[0,0,0],[.53,.62,.47]);
    model(boat,'round','#694e55',[0,.021,0],[.244,.035,.385]);
    model(boat,'box','#c28c64',[0,.111,.058],[.421,.035,.116]);
    model(boat,'stem','#c79868',[.26,.123,-.04],[.016,.63,.018],[Math.PI/2,0,-.29]);
    batchRepeatedParts(root,boat);
    boat.rotation.y = mooring;
    if (mini) return {
      animate(seconds,night) { window.emissiveIntensity=night*1.43; }
    };
    const wake = rings(boatAnchor,[boatX,boatY+.01,boatZ],'#f8c5dc',narrow ? .52 : .82);
    const floatX = narrow ? -.17 : -.29, floatZ = narrow ? .94 : 2.01;
    const animateFisher = Inhabitants.fisher(root,dockEnd,new Vector3(floatX,waterY(floatX,floatZ)+.032,floatZ));
    let start = -Infinity;
    return {
      trigger(seconds) { start = seconds; wake.trigger(seconds); },
      animate(seconds,night) {
        window.emissiveIntensity=night*1.43;
        animateFisher(seconds);
        const t = Math.max(0,seconds-start);
        const rock = Number.isFinite(t) ? Math.sin(t*10)*Math.exp(-t*2.05)*.22 : 0;
        boat.position.y = boatY + Math.sin(seconds*1.9)*.023;
        boat.rotation.set(.02*Math.sin(seconds*2.1),mooring + .053*Math.cos(seconds*.92),rock + .042*Math.sin(seconds*2.4));
        wake.update(seconds);
      }
    };
  }

  function frogSet(root, mini, ground, pier) {
    const stage = new Group();
    stage.position.set(.25,.102,.06);
    root.add(stage);
    model(stage,'pebble','#71847a',[0,-.032,0],[.53,.151,.40],[0,.3,0]);
    const actor = new Group();
    actor.name = 'Лягушка';
    actor.position.set(0,.089,0);
    stage.add(actor);
    model(actor,'round','#93bd62',[0,.24,0],[.425,.25,.35]);
    model(actor,'round','#d2dfa1',[0,.181,.148],[.354,.138,.255]);
    const eyes = [];
    for (const side of [-1,1]) {
      model(actor,'round','#85b55d',[side*.264,.408,-.018],[.157,.154,.135]);
      const eye = new Group();
      eye.position.set(side*.26,.447,.082);
      actor.add(eye);
      model(eye,'round','#ecedc4',[0,0,0],[.105,.107,.043]);
      model(eye,'round','#354d42',[0,-.007,.033],[.064,.075,.029]);
      model(eye,'tiny','#fff7c6',[-.024,.024,.057],[.022,.023,.010]);
      eyes.push(eye);
      model(actor,'round','#81ab5b',[side*.342,.126,.067],[.167,.079,.223]);
      model(actor,'pebble','#73a65a',[side*.097,.414,.149],[.036,.013,.033]);
    }
    const pads = [
      [-.50,.018,.45,.34,1.3,true], [.75,.014,.60,.40,2.7,true],
      [.90,-.042,-.44,.45,.9,false], [-.59,-.015,-.45,.28,2.6,false],
      [.44,-.05,1.00,.28,.2,false], [-.13,.036,-.70,.30,4.1,true]
    ].map(([x,y,z,s,angle,bloom]) => ({object:lily(root,x,y,z,s,angle,bloom), center:y, angle}));
    for (const [x,z,height,angle] of [[-1.07,-.70,.70,.3],[.96,-.77,.95,2.1],[.77,-.90,.58,2.9]]) {
      model(root,'stem','#789658',[x,height/2,z],[.043,height,.043],[0,0,-.09]);
      const pad = lily(root,x+.055,height,z,.41,angle);
      pad.rotateZ(-.25);
    }
    if (mini) return;
    const splashX=.26, splashZ=.48, waterRadius=Land.radius+Land.waterLevel+.012;
    const splash=[splashX,Math.sqrt(waterRadius**2-splashX**2-splashZ**2)-root.position.length(),splashZ];
    const waterRing = rings(root,splash,'#d9f9d6',1.02);
    const visitor = Inhabitants.pondVisitor(ground,pier,(point) => ground.worldToLocal(root.localToWorld(point.fromArray(splash))));
    return {
      trigger: visitor.trigger,
      animate(seconds) {
        const jumpStart = visitor.animate(seconds)+.11;
        const t = clamp((seconds-jumpStart)/.66,0,1);
        const jump = Math.sin(t*Math.PI);
        actor.position.y = .089 + .46*jump;
        actor.scale.y = 1 + .08*jump + .029*Math.sin(seconds*2.65);
        const blink = Math.pow(Math.max(0,Math.cos(seconds*1.67 + .63)),70);
        for (const eye of eyes) eye.scale.y = 1 - .93*blink;
        for (const [i,{object,center,angle}] of pads.entries()) {
          object.position.y = center + .014*Math.sin(seconds*1.55+i*1.61);
          object.rotation.y = angle + .052*Math.sin(seconds*.64+i);
          object.rotation.z = .022*Math.sin(seconds*1.34+i);
        }
        waterRing.trigger(jumpStart-.11);
        waterRing.update(seconds);
      }
    };
  }

  function meadowSet(root) {
    const planter = new Group();
    root.add(planter);
    model(planter,'box','#8d694c',[0,.038,0],[.61,.103,.52]);
    model(planter,'box','#bd9866',[0,.094,0],[.653,.04,.548]);
    const flowers = [];
    for (let i=0;i<7;i++) {
      const base = new Group();
      base.position.set(((i%3)-1)*.187,.11,(Math.floor(i/3)-1)*.159);
      planter.add(base);
      model(base,'stem','#789c58',[0,.105,0],[.018,.214,.018]);
      for(let p=0;p<5;p++) {
        const a=p/5*tau;
        model(base,'round',i%2?'#f19eab':'#f7d270',[.042*Math.cos(a),.206,.042*Math.sin(a)],[.04,.023,.033],[0,-a,0]);
      }
      model(base,'tiny','#fff0af',[0,.221,0],[.030,.022,.029]);
      batchRepeatedParts(base);
      flowers.push(base);
    }
    const drops = [];
    for (let i=0;i<13;i++) {
      const drop = model(root,'tiny','#9ae5ef',[0,0,0],[.026,.046,.026]);
      drop.castShadow = false;
      drop.visible = false;
      drops.push(drop);
    }
    const gardener = Inhabitants.gardener(root);
    let start = -Infinity;
    return {
      trigger(seconds) { start = seconds; },
      animate(seconds) {
        const watering = Math.max(start,latestEvent(seconds,gardener.waterAt,gardener.cycle));
        const elapsed = seconds - watering;
        gardener.animate(seconds,elapsed);
        const source = elapsed > 0 && elapsed < 1.2 ? gardener.spout() : null;
        for (const [i,drop] of drops.entries()) {
          const t = (elapsed-i*.047)/.55;
          drop.visible = Boolean(source) && t > 0 && t < 1;
          if (!drop.visible) continue;
          drop.position.set(lerp(source.x,(i%5-2)*.096,t),lerp(source.y,.137,t) + Math.sin(t*Math.PI)*.105,
            lerp(source.z,.17*Math.sin(i*2),t));
        }
        for (const [i,flower] of flowers.entries()) {
          const bloom = Number.isFinite(watering) ? smoothstep(elapsed-i*.059,.24,1.28) : 0;
          flower.scale.setScalar(.84 + .37*bloom);
          flower.rotation.z = .06*Math.sin(seconds*1.35 + i) * (1 + bloom);
        }
      }
    };
  }

  function createWorld(kind, miniature = false) {
    const group = new Group();
    const surface = defineSurface(kind);
    const time = terrain(group,kind,surface,miniature);
    const insectSites = vegetation(group,kind,surface,miniature);
    const animateButterflies = insectSites.length ? Scenery.butterflies(group,insectSites,surface.frameAt) : null;
    let interaction;
    let landscape;
    if (kind === 'shore') {
      const site = groupAt(surface.frameAt,.01,.135,.015,-.19);
      group.add(site);
      const mooring = ShoreLife.mooring();
      const boatAnchor = groupAt(surface.frameAt,mooring.lon,mooring.lat);
      boatAnchor.position.setLength(Land.radius+Land.waterLevel);
      group.add(boatAnchor);
      interaction = shoreSet(site,miniature,boatAnchor);
      landscape = Landforms.buildShore(group,surface,miniature,site);
    } else if (kind === 'pond') {
      const site = groupAt(surface.frameAt,.12,-.15,.14,-.12);
      group.add(site);
      const pier = Landforms.boardwalk(group,surface,Landforms.routes.pond);
      interaction = frogSet(site,miniature,group,pier);
      landscape = Landforms.buildPond(group,surface,miniature);
    } else {
      const site = groupAt(surface.frameAt,-.44,.53,0,-.16);
      site.scale.setScalar(.9);
      group.add(site);
      model(site,'round','#f1dfb3',[0,.45,0],[.58,.49,.49]);
      model(site,'round','#d68862',[0,.77,0],[.63,.37,.55]);
      model(site,'round','#8faa73',[0,.26,.46],[.145,.22,.069]);
      model(site,'stem','#98694c',[-.28,.93,-.10],[.078,.37,.071]);
    }
    const animateFlyers = !miniature && kind !== 'meadow' ? Inhabitants.flyers(group,kind,surface.frameAt) : null;
    const animateLandmarks = Landmarks.create(group,surface,kind,miniature);
    if (miniature) group.traverse((part) => { part.castShadow = false; part.receiveShadow = false; });
    return {
      group,
      animate(seconds,night=0) {
        time.value = seconds;
        interaction?.animate(seconds,night);
        landscape?.(seconds,night);
        animateLandmarks?.(seconds,night);
        animateFlyers?.(seconds);
        animateButterflies?.(seconds);
      },
      trigger(seconds) { interaction?.trigger(seconds); }
    };
  }

  function addDistricts(world) {
    const group = new Group();
    world.add(group);
    const planters = groupAt(Land.frame,-.292,.43,.002,-.33);
    world.add(planters);
    const meadow = meadowSet(planters);
    const coast = groupAt(Land.frame,2.69,.385,.04,-.44);
    const harbor = shoreSet(coast,false);
    group.add(coast);
    const {positionAt,add,commit} = makeDecoration(group);
    for (const [lon,lat,scale] of [[2.72,.54,.95],[2.86,.45,.86],[2.80,.60,1.08],[2.53,.69,.82],[2.71,.78,.82],[2.89,.64,.66]]) {
      positionAt(lon,lat,-.04,lon,scale);
      add('stem','#9d6d50',[0,.44,0],[.088,.92,.088]);
      for(let i=0;i<5;i++) {
        const radius = .36 - i*.05;
        add('pebble',palette.shore.trees[i%3],[.058*Math.cos(i*2),.55+i*.22,0],[radius,.46,radius],[0,i,-.12]);
      }
    }
    commit();
    const wetlands = groupAt(Land.frame,.83,-.41,.137,-.12);
    const pier = Landforms.boardwalk(group,defineSurface('meadow'),Landforms.routes.district);
    const pond = frogSet(wetlands,false,group,pier);
    group.add(wetlands);
    return {
      group,
      animate(seconds,night=0) {
        meadow.animate(seconds);
        if (group.visible) {
          harbor.animate(seconds,night);
          pond.animate(seconds);
        }
      },
      trigger(place, seconds) {
        ({meadow, shore:harbor, pond})[place]?.trigger(seconds);
      }
    };
  }

  return {createWorld, addDistricts, view, places};
})();

;
const Atlas = (() => {
  const regions = {
    meadow: { title: ['Meadow'], visit: 'Visit the cottage', act: 'Water the flowers', response: 'You watered the flowers.' },
    shore: { title: ['Golden','Coast'], visit: 'Visit the pier', act: 'Rock the boat', response: 'The boat rocked.' },
    pond: { title: ['Lily','Pond'], visit: 'Find the frog', act: 'Feed the frog', response: 'You fed the frog by the dock.' },
    clover: { title: ['Clover','Valley'], visit: 'Visit the sheep pen', act: 'Ring the bell', response: 'The flock perked up.' }
  };

  function createMeadow() {
    const meadow = new THREE.Group();
    const water = Land.create(meadow);
    const animateMeadow = Scenery.create(meadow);
    const districts = Biomes.addDistricts(meadow);
    return {
      group:meadow, water,
      expand(oneWorld) {
        districts.group.visible = oneWorld;
        water.expanded.value = Number(oneWorld);
      },
      animate(seconds,night,scale) {
        water.time.value = seconds;
        water.night.value = night;
        water.waterMaterial.roughness = THREE.MathUtils.lerp(.83,.49,night);
        water.waterMaterial.emissiveIntensity = night*.13;
        animateMeadow(seconds,night,scale);
        districts.animate(seconds,night);
      },
      trigger(seconds,place) { districts.trigger(place,seconds); }
    };
  }

  function create(scene,deferWorlds=false) {
    const bodies = new Map();
    const forward = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
    const miniatureAngle = new THREE.Quaternion().setFromEuler(new THREE.Euler(.17,-.07,0));
    for (const name of Object.keys(regions)) {
      const root = new THREE.Group();
      scene.add(root);
      bodies.set(name,{root});
    }

    function getModel(name) {
      const body=bodies.get(name);
      if(!body.model) {
        body.model=name==='meadow'?createMeadow():name==='clover'?Clover.create():Biomes.createWorld(name);
        body.detail=body.model.group;
        body.root.add(body.detail);
      }
      return body.model;
    }

    function getMiniature(name) {
      const body=bodies.get(name);
      if(!body.miniature) {
        body.miniature=name==='clover'?Clover.create(true):Biomes.createWorld(name,true);
        body.mini=body.miniature.group;
        body.mini.visible=false;
        body.root.add(body.mini);
      }
      return body.mini;
    }

    if(!deferWorlds) {
      for(const name of bodies.keys()) getModel(name);
      for(const name of bodies.keys()) getMiniature(name).visible=true;
    }

    function show(active, oneWorld, onlyActive=false) {
      getModel(active);
      bodies.get('meadow').model?.expand(oneWorld);
      for (const [name, body] of bodies) {
        const satellite=name!==active && !oneWorld && !onlyActive;
        if(satellite) getMiniature(name);
        body.root.visible = name === active || satellite;
        if(body.detail) body.detail.visible=name===active;
        if(body.mini) body.mini.visible=satellite;
      }
    }

    function layoutSatellites(camera, active, buttons, close) {
      const compact = camera.aspect < .80;
      const span = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const diameter = compact ? .098 : .135;
      const depth = Land.radius / (span * diameter);
      const slots = compact ? [[-.72,.52],[.72,.56],[-.72,-.46]] : [[-.79,.23],[.79,.20],[.79,-.43]];
      camera.getWorldDirection(forward);
      side.set(1,0,0).applyQuaternion(camera.quaternion);
      up.set(0,1,0).applyQuaternion(camera.quaternion);
      let index = 0;
      for (const [name, {root}] of bodies) {
        if (name === active) continue;
        const [x,y] = slots[index++];
        root.visible = !close;
        root.position.copy(camera.position).addScaledVector(forward,depth)
          .addScaledVector(side,depth*span*camera.aspect*x).addScaledVector(up,depth*span*y);
        // Keep the same face of each miniature pointed toward the viewer.
        root.quaternion.copy(camera.quaternion).multiply(miniatureAngle);
        const button = buttons.get(name);
        button.style.left = ((x+1)*50)+'%';
        button.style.top = ((1-y)*50)+'%';
      }
    }

    function animate(name, seconds, night, scale) {
      getModel(name).animate(seconds,night,scale);
      for (const {root,mini,miniature} of bodies.values()) {
        if (root.visible && mini?.visible) miniature.animate(seconds,night);
      }
    }

    function act(name, place, seconds) {
      getModel(name).trigger(seconds,place);
    }

    return { bodies, get water(){return getModel('meadow').water;}, getModel, getMiniature, show, layoutSatellites, animate, act };
  }

  return { create, regions };
})();

;
const CosmicWorlds=(()=>{
  const {Color,Group,Mesh,Vector3}=THREE;
  const {clamp,smoothstep}=THREE.MathUtils;
  const {model,batchRepeatedParts}=Scenery;
  const smallRock=new THREE.IcosahedronGeometry(1,0);

  function layers(parent,rings,colors,seed) {
    const random=Land.rng(seed);
    const width=12, points=[], positions=[], tints=[];
    for(const [j,[y,radius]] of rings.entries()) {
      for(let i=0;i<width;i++) {
        const a=i*Land.tau/width+(j%2)*.17;
        const widthAtPoint=radius*(.86+random()*.28);
        points.push([Math.cos(a)*widthAtPoint,y+(random()-.5)*.16,Math.sin(a)*widthAtPoint*.82]);
      }
    }
    function face(a,b,c,h) {
      const tint=new Color(colors[Math.min(h,colors.length-1)]).multiplyScalar(.90+random()*.23);
      for(const point of [a,b,c]) {
        positions.push(...point);
        tints.push(tint.r,tint.g,tint.b);
      }
    }
    for(let j=0;j<rings.length-1;j++) for(let i=0;i<width;i++) {
      const start=j*width,next=(j+1)*width,k=(i+1)%width;
      face(points[start+i],points[next+i],points[start+k],j);
      face(points[start+k],points[next+i],points[next+k],j);
    }
    const cap=(rings.length-1)*width;
    for(let i=0;i<width;i++) {
      const k=(i+1)%width;
      face(points[cap+i],[0,rings[rings.length-1][0]+.10,0],points[cap+k],rings.length-1);
      face(points[i],points[k],[0,rings[0][0]-.13,0],0);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));
    geo.computeVertexNormals();
    const rock=new Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.97,side:THREE.DoubleSide}));
    rock.castShadow=rock.receiveShadow=true;
    parent.add(rock);
  }

  function amberTree(root,x,y,z,size,lean) {
    const tree=new Group();
    tree.position.set(x,y,z);
    tree.scale.setScalar(size);
    tree.rotation.z=lean;
    root.add(tree);
    model(tree,'stem','#a45839',[0,.34,0],[.069,.72,.064],[0,0,-.27]);
    model(tree,'stem','#ad5f36',[.09,.53,.015],[.043,.34,.041],[.13,0,-.56]);
    model(tree,'pebble','#d89152',[.075,.86,.035],[.321,.286,.297],[.16,.18,.4]);
    model(tree,'pebble','#e6aa5e',[.24,.78,-.039],[.213,.229,.213],[.04,.54,-.11]);
    model(tree,'pebble','#cb7850',[-.15,.72,.039],[.193,.202,.203],[.13,.53,.21]);
  }

  function amber() {
    const group=new Group();
    layers(group,[[-2.66,.27],[-2.02,.86],[-1.30,1.50],[-.75,2.22],[-.40,2.66]],
      ['#8c5049','#b26743','#d28c4e','#e2a15c','#edb66a'],6251);
    layers(group,[[-.39,1.68],[.12,1.43],[.38,1.22]],['#bd7746','#e39852','#f1bd76'],937);
    for(const [x,y,z,s,lean] of [[-.84,.47,-.16,.89,.10],[-.49,.50,-.79,.72,-.23],[-1.77,-.32,.22,.79,.04],
      [1.63,-.34,-.13,.67,.18],[1.85,-.35,.56,.59,-.15],[.98,.43,-.39,.54,.11],[-1.72,-.21,-.60,.61,.08]]) {
      amberTree(group,x,y,z,s,lean);
    }
    const tower=new Group();
    tower.position.set(.32,.43,.018);
    group.userData.demoFocus=tower.position.clone().add(new Vector3(0,.86,0));
    tower.rotation.y=-.32;
    group.add(tower);
    model(tower,'box','#d8a16a',[0,.87,0],[.60,1.74,.55]);
    for(let j=0;j<3;j++) model(tower,'box','#a96550',[0,.53+j*.45,0],[.688,.087,.628]);
    model(tower,'box','#a06c59',[0,.17,.295],[.142,.27,.036]);
    const glass=new THREE.MeshStandardMaterial({color:'#ffd190',emissive:'#f98f37',emissiveIntensity:.55,roughness:.75});
    for(const [x,y] of [[-.14,.69],[.14,.69],[0,1.139],[0,1.495]]) {
      model(tower,'box','#a26e53',[x,y,.286],[.144,.20,.051]);
      model(tower,'box',glass,[x,y,.316],[.099,.151,.025]);
    }
    for(const s of [-1,1]) {
      model(tower,'box','#c5724a',[s*.18,1.835,0],[.505,.082,.715],[0,0,s*-.62]);
      model(tower,'box','#935442',[s*.327,1.733,0],[.076,.067,.735],[0,0,s*-.62]);
    }
    model(tower,'box','#9c5845',[0,2.003,0],[.08,.069,.76]);
    for(const [i,[x,z]] of [[-.90,.72],[-1.06,.95],[-1.18,1.04],[1.36,.89],[1.55,.73],[1.63,.94]].entries()) {
      model(group,smallRock,i%2?'#e8a461':'#c88953',[x,-.29,z],[.138,.115,.167],[.13,i*.58,.14]);
    }
    for(let j=0;j<4;j++) model(group,'box','#a97453',[.08+j*.081,-.19+j*.165,.95-j*.126],[.41,.074,.172],[0,.12,0]);
    const pebblePositions=[[-2.83,.08,1.4,.19],[2.73,-.68,.5,.23],[-2.34,-1.54,1.22,.16],[2.51,-1.23,-.81,.14]];
    for(const [x,y,z,s] of pebblePositions) model(group,smallRock,'#d59763',[x,y,z],[s,.72*s,s],[y,.45,x]);
    const observatory=new Group();
    observatory.position.set(-.48,.46,.66);
    observatory.rotation.y=-.58;
    group.add(observatory);
    model(observatory,'pebble','#d49e63',[0,-.042,-.024],[.415,.096,.285]);
    for (const [i,[x,z]] of [[-.112,.077],[.117,.075],[0,-.100]].entries()) {
      model(observatory,'stem','#a87559',[x,.145,z],[.024,.287,.023],[.31*Math.cos(i*2.4),0,.28*Math.sin(i*2.4)]);
    }
    const reflector=new Group();
    reflector.position.set(0,.28,.018);
    reflector.rotation.x=1.24;
    observatory.add(reflector);
    model(reflector,'stem','#958e79',[0,.022,0],[.058,.286,.059]);
    model(reflector,'stem','#d7b17a',[0,.166,0],[.073,.063,.073]);
    model(reflector,'stem','#6b8985',[0,.202,0],[.053,.015,.053]);
    const lantern=Landforms.lamp(observatory,.29,0,.09,true);
    const keeper=Inhabitants.resident(group,'traveler',.98);
    keeper.base.name='Смотритель за телескопом';
    const embers=new Group();
    group.add(embers);
    const warm=new THREE.MeshStandardMaterial({color:'#f6d79c',emissive:'#d68955',emissiveIntensity:.83,roughness:1});
    const fliers=Array.from({length:6},(_,i)=>model(embers,'tiny',warm,[0,0,0],[.030+i%2*.008,.028,.029]));
    fliers.forEach(part=>{part.castShadow=false;});
    batchRepeatedParts(tower);
    group.userData.animate=(seconds)=>{
      const t=(seconds+2)%15.6;
      const out=smoothstep(t,.71,3.68),back=smoothstep(t,10.12,13.93);
      const visit=out-back;
      keeper.base.position.set(.30-.56*visit,.505,.533+.20*Math.sin(visit*1.64));
      keeper.base.rotation.y=-1.31-1.08*smoothstep(t,3.49,4.35)+3.14*smoothstep(t,9.6,10.13)-2.06*smoothstep(t,13.7,15.4);
      const reach=smoothstep(t,4.25,4.9)-smoothstep(t,8.55,9.42);
      const stride=smoothstep(t,.66,1)-smoothstep(t,3.36,3.73)+smoothstep(t,10.10,10.45)-smoothstep(t,13.6,13.96);
      keeper.pose(seconds,stride*.76,.16+reach*.88);
      reflector.rotation.x=1.27+.13*reach*Math.sin(t*1.65);
      lantern(seconds,.64);
      for(const [i,spark] of fliers.entries()) {
        const a=seconds*(.59+i*.052)+i*2.4;
        spark.position.set(-1.11+.43*Math.cos(a),.37+.21*Math.sin(a*1.73)+i%3*.09,.79+.27*Math.sin(a*1.13));
      }
    };
    group.userData.animate(0);
    return group;
  }

  function giant() {
    const group=new Group();
    const random=Land.rng(84329);
    const clay=new Color('#c58d89'), lilac=new Color('#a79abe'), sand=new Color('#e6b9a3');
    const heights=[
      [-.65,.38,.34,20],[-.87,.51,.23,35],[-.40,.61,.18,24],[.71,-.32,.27,19],
      [.86,.11,.21,25],[2.05,.46,.32,19],[-2.58,-.36,.29,20],[2.75,-.63,.26,22]
    ].map(([lon,lat,rise,spread])=>({center:Land.direction(lon,lat),rise,spread}));
    function terrain(normal) {
      const {x,y,z}=normal;
      const tide=y+.085*Math.sin(4*x+2*z)+.039*Math.cos(7*z-3*x);
      const ridge=heights.reduce((sum,{center,rise,spread})=>sum+rise*Math.exp((normal.dot(center)-1)*spread),0);
      const texture=.025*Math.sin(10*x+6*y)*Math.cos(9*z-8*y);
      return {height:2.86+ridge+texture+.047*Math.cos(tide*12),tide,ridge};
    }
    const geo=Land.globeGeometry(122,68,(lon,lat)=>{
      const n=Land.direction(lon,lat);
      const {height,tide,ridge}=terrain(n);
      const color=clay.clone().lerp(lilac,smoothstep(Math.sin(tide*7+1.1),-.61,.71)*.83);
      color.lerp(sand,.45*smoothstep(Math.cos(tide*13.4-1.4),-.22,.97)+Math.min(.31,ridge*.78));
      return {position:n.multiplyScalar(height),color};
    });
    const globe=new Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
    globe.castShadow=globe.receiveShadow=true;
    globe.name='Рельеф Полосатого гиганта';
    group.add(globe);

    function site(lon,lat,offset=0) {
      const frame=Land.frame(lon,lat);
      const patch=new Group();
      patch.position.copy(frame.position).setLength(terrain(Land.direction(lon,lat)).height+offset);
      patch.quaternion.copy(frame.rotation);
      ground.add(patch);
      return patch;
    }
    const ground=new Group();
    group.add(ground);
    const rockTints=['#c69289','#b88486','#d4a391','#aa95b0'];
    const growthTints=['#cba6ba','#927f9e','#d9b4b7','#819b9c'];
    for(let i=0;i<74;i++) {
      const lon=(i*2.399963)%Land.tau;
      const lat=Math.asin((i+.5)/37-1);
      const patch=site(lon,lat);
      const size=.068+random()*.19;
      const hue=i%rockTints.length;
      for(let j=0;j<3;j++) {
        const angle=j*2.4+i;
        model(patch,'pebble',rockTints[(hue+j)%rockTints.length],
          [size*.85*Math.cos(angle),0,size*.66*Math.sin(angle)],
          [size*(.55+random()*.47),size*(.29+random()*.31),size*.68],[.16,angle,.32]);
      }
      if(i%3!==0) continue;
      for(let j=0;j<3;j++) {
        const angle=j*2.399+i, height=.14+random()*.13;
        model(patch,'stem','#907889',[size*.51*Math.cos(angle),height*.33,size*.51*Math.sin(angle)],[.015,height,.015],[.36,angle,.34]);
        model(patch,'pebble',growthTints[(hue+j)%growthTints.length],
          [size*.83*Math.cos(angle),height*.91,size*.83*Math.sin(angle)],[.048,height*.47,.065],[.36,angle,.34]);
      }
    }
    for(const [lon,lat,yaw] of [[.43,.29,-.20],[2.68,.45,.71],[-2.38,-.42,.19]]) {
      const station=site(lon,lat);
      station.name='Облачная метеостанция';
      group.userData.demoFocus??=station.position.clone();
      station.rotateY(yaw);
      model(station,'pebble','#bd958a',[0,.014,0],[.52,.102,.40]);
      model(station,'box','#b68371',[0,.065,.015],[.60,.092,.49]);
      model(station,'box','#e1c1a7',[0,.22,-.03],[.46,.27,.34]);
      for(const side of [-1,1]) {
        model(station,'box','#789b9b',[side*.115,.381,-.03],[.296,.065,.43],[0,0,-side*.53]);
        model(station,'box','#9a756e',[side*.13,.23,.149],[.086,.11,.023]);
        model(station,'box','#ecbe85',[side*.13,.236,.167],[.061,.071,.018]);
      }
      model(station,'box','#866e72',[0,.161,.157],[.109,.153,.034]);
      model(station,'stem','#a1847b',[.34,.185,-.02],[.025,.39,.025]);
      model(station,'round','#d7c3b8',[.34,.387,-.02],[.104,.042,.084],[.57,0,.38]);
      for(let j=0;j<5;j++) model(station,'pebble','#d7ae97',[.12+j*.044,.005,.28+j*.109],[.067,.037,.051],[0,j*.4,0]);
    }
    batchRepeatedParts(ground);

    const clouds=new Group();
    clouds.name='Кремовые облака гиганта';
    group.add(clouds);
    const cloudTints=['#dfb9b2','#edc9b8','#e8cdc0','#d8b7bf'];
    for(const [lon,lat,size] of [[-.70,.69,1.04],[-1.14,.36,.72],[.62,.80,.77],[.88,-.31,.82],
      [-.57,-.41,.86],[1.44,.25,.95],[1.96,-.57,.79],[2.65,.82,.83],[-2.31,.08,.88],[-1.58,-.79,1.02]]) {
      const frame=Land.frame(lon,lat);
      const cloud=new Group();
      cloud.position.copy(frame.position).setLength(terrain(Land.direction(lon,lat)).height+.20);
      cloud.quaternion.copy(frame.rotation);
      cloud.rotateY(lon*.35);
      clouds.add(cloud);
      for(let j=0;j<4;j++) {
        model(cloud,'pebble',cloudTints[j],[(j-1.5)*.17*size,.025+(j%2)*.052*size,.02*j],
          [(j%2?.24:.20)*size,(j%2?.145:.105)*size,.171*size],[.07,0,.12]);
      }
    }
    batchRepeatedParts(clouds);

    const ring=new Group();
    ring.rotation.set(.10,0,-.18);
    group.add(ring);
    const inner=3.49,outer=4.10;
    const pathTop=new THREE.RingGeometry(inner,outer,112).rotateX(-Math.PI/2);
    for(const [height,color] of [[0,'#dab79b'],[-.105,'#a68585']]) {
      model(ring,pathTop,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}),
        [0,height,0],[1,1,1]);
    }
    for(const [radius,color] of [[inner,'#b08b88'],[outer,'#ae8886']]) {
      const rim=new THREE.CylinderGeometry(radius,radius,.105,112,1,true);
      model(ring,rim,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}),
        [0,-.0525,0],[1,1,1]);
    }
    const trim=new Group();
    ring.add(trim);
    for(let i=0;i<42;i++) {
      const angle=i*Land.tau/42, radius=4.018, stone=i%7===0;
      model(trim,stone?'pebble':'box',stone?'#e1c3a3':'#bf9e8e',[Math.cos(angle)*radius,.009,Math.sin(angle)*radius],
        stone?[.044,.041,.064]:[.052,.012,.022],[0,-angle,0]);
    }
    batchRepeatedParts(trim);
    const standing=1.76;
    const sensor=new Group();
    sensor.position.set(Math.cos(standing)*3.96,.018,Math.sin(standing)*3.96);
    sensor.rotation.y=-standing;
    ring.add(sensor);
    model(sensor,'box','#84656a',[0,.025,0],[.211,.063,.144]);
    model(sensor,'stem','#d4c5ac',[0,.17,0],[.021,.29,.022]);
    model(sensor,'box','#bda99b',[0,.308,0],[.127,.124,.083],[.11,0,0]);
    const signal=new THREE.MeshStandardMaterial({color:'#b9d8c5',emissive:'#6caeb2',emissiveIntensity:.39,roughness:.53});
    model(sensor,'box',signal,[0,.310,.045],[.081,.047,.012]);
    const astronaut=Inhabitants.resident(ring,'maker',1.08);
    astronaut.base.name='Космонавт на кольце';
    for(const part of astronaut.head.children) part.visible=false;
    model(astronaut.head,'round','#f3dcca',[0,.027,.013],[.148,.160,.149]);
    model(astronaut.head,'round','#58767e',[0,.022,.132],[.106,.098,.058],[.03,0,0]);
    model(astronaut.head,'tiny','#d3b59e',[-.045,.058,.178],[.036,.019,.010],[0,0,.12]);
    model(astronaut.torso,'box','#c5a389',[0,.319,-.092],[.135,.170,.073]);
    for(const side of [-1,1]) model(astronaut.head,'tiny','#d18b68',[side*.129,.025,.016],[.026,.037,.037]);
    const bloom=new THREE.MeshStandardMaterial({color:'#d6bbcd',emissive:'#c492a9',emissiveIntensity:.22,roughness:.9});
    const creatures=[];
    for(let j=0;j<3;j++) {
      const actor=new Group();
      actor.name=`Медуза в облаках ${j+1}`;
      group.add(actor);
      const hood=model(actor,'round',bloom,[0,.064,0],[.173,.094,.147]);
      model(actor,'tiny','#ba8d9e',[0,.031,0],[.135,.027,.111]);
      const feelers=[];
      for(let i=0;i<5;i++) {
        const a=i*Land.tau/5;
        const tentacle=new Group();
        tentacle.position.set(.101*Math.cos(a),.016,.088*Math.sin(a));
        actor.add(tentacle);
        for(let k=0;k<3;k++) model(tentacle,'tiny',k%2?'#cba5b2':'#b78fae',
          [.014*Math.sin(k*1.78+a),-.063-k*.055,0],[.014,.050,.014],[.12,0,a*.11]);
        batchRepeatedParts(tentacle);
        feelers.push(tentacle);
      }
      creatures.push({actor,feelers,hood});
    }
    group.userData.animate=(seconds)=>{
      const t=(seconds+1.2)%33;
      const approach=clamp(t/6.8,0,1);
      const loop=clamp((t-10.4)/22.6,0,1);
      const here=THREE.MathUtils.lerp(.63,standing,approach)+(Land.tau+.63-standing)*loop;
      astronaut.base.position.set(Math.cos(here)*3.74,.014,Math.sin(here)*3.74);
      const reading=smoothstep(t,6.8,7.35)-smoothstep(t,9.0,9.8);
      astronaut.base.rotation.y=-here+reading*Math.PI*.5;
      const walk=1-(smoothstep(t,6.45,6.80)-smoothstep(t,10.37,10.89));
      astronaut.pose(seconds,walk*.8,.15+.73*reading);
      signal.emissiveIntensity=.35+reading*(.51+.19*Math.sin(seconds*9));
      for(const [i,{actor,feelers,hood}] of creatures.entries()) {
        const a=seconds*.32+i*1.73;
        const lon=-.94+i*.80+.12*Math.cos(a);
        const lat=.36-i*.26+.13*Math.sin(a*.81);
        const frame=Land.frame(lon,lat);
        actor.position.copy(frame.position).setLength(terrain(Land.direction(lon,lat)).height+.24+.09*Math.sin(a-.4));
        actor.quaternion.copy(frame.rotation);
        actor.rotateZ(.19*Math.sin(a*1.12));
        hood.scale.y=.094*(1+.14*Math.sin(seconds*2.1+i));
        for(const [j,feel] of feelers.entries()) feel.position.x=.100*Math.cos(j*Land.tau/5)+.037*Math.sin(seconds*2.4+i+j*.44);
      }
    };
    group.userData.animate(0);
    return group;
  }

  function belt() {
    const group=new Group();
    group.userData.demoFocus=new Vector3(0,.42,-.12);
    layers(group,[[-1.82,.61],[-1.49,1.53],[-.88,2.04],[-.30,2.15]],
      ['#493e49','#82594e','#ae6851','#bd775c'],7122);
    // The gap under the arch stays open as the camera turns around it.
    for(let i=0;i<8;i++) {
      const a=.12+i/7*(Math.PI-.24);
      const x=Math.cos(a)*1.09,y=Math.sin(a)*1.22-.28;
      model(group,smallRock,i%2?'#bc7558':'#a56458',[x,y,-.30],[.50,.39,.41],[0,i*.45,a-Math.PI*.5]);
    }
    for(const [x,y,z,s] of [[-1.7,.05,.45,.41],[1.47,.05,.70,.39],[-1.28,.19,-.61,.54],
      [-.13,-.06,1.05,.27],[.68,-.075,.89,.18],[1.33,.60,-.71,.67]]) {
      model(group,smallRock,'#bc7b62',[x,y,z],[s,s*.83,s*1.06],[.2,z,.17]);
    }
    for(const [x,y,z,s] of [[-2.72,1.05,-1,.37],[2.79,-.43,-.1,.46],[-2.4,-.91,1.4,.17],
      [1.80,1.66,-1.50,.26],[-1.62,1.68,-.50,.19],[2.74,.67,-1.9,.18],[.9,-1.74,1.71,.18]]) {
      model(group,smallRock,'#9d6858',[x,y,z],[s,s*.96,s*.78],[.36,y,.21]);
    }
    const drone=new Group();
    drone.name='Геологический дрон';
    group.add(drone);
    model(drone,'pebble','#bcb6a4',[0,0,0],[.163,.088,.136]);
    model(drone,'box','#718487',[0,.019,.105],[.128,.066,.067]);
    const optic=new THREE.MeshStandardMaterial({color:'#8fcbba',emissive:'#66b4a9',emissiveIntensity:.58,roughness:.62});
    model(drone,'round',optic,[0,.017,.153],[.046,.031,.030]);
    for(const s of [-1,1]) {
      model(drone,'box','#ae9075',[s*.16,-.02,0],[.105,.061,.160],[0,0,s*.15]);
      model(drone,'stem','#7f7f76',[s*.207,-.035,.014],[.068,.050,.068]);
    }
    const cone=new THREE.ConeGeometry(.17,.51,12,1,true).translate(0,-.253,0);
    const scanMaterial=new THREE.MeshBasicMaterial({color:'#b4e0c6',transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
    const scan=model(drone,cone,scanMaterial,[0,-.041,.014],[1,1,1]);
    scan.castShadow=false;
    group.userData.animate=(seconds)=>{
      const t=(seconds+.5)%16.4;
      const going=smoothstep(t,1.42,5.17),home=smoothstep(t,11.11,15.17);
      const travel=going-home;
      drone.position.set(-1.44+travel*2.82,.31+.24*Math.sin(Math.PI*travel)+.072*Math.sin(seconds*3.5),1.04-.48*travel);
      drone.rotation.set(.05*Math.sin(seconds*3.8),.87+1.32*smoothstep(t,9.2,11.4),.12*Math.sin(seconds*2.49));
      const active=smoothstep(t,5.21,5.80)-smoothstep(t,9.35,10.2);
      scan.visible=active>.025;
      scanMaterial.opacity=active*(.16+.027*Math.sin(seconds*11));
      optic.emissiveIntensity=.42+active*.56;
    };
    group.userData.animate(0);
    return group;
  }

  return {amber,giant,belt};
})();

;
const FrostVegetation=(()=>{
  const {Vector3,Group}=THREE;
  const {model}=Scenery;
  const birch='#acbcc4', shade='#677989';
  const leaves=['#314c57','#435e67','#526a73'];
  const needles=['#315a50','#3d6859','#4b7465'];
  const snow=['#8eabb8','#adc4cc','#baccd1'];
  const icicle=new THREE.ConeGeometry(1,1,5);
  function drawLink(parent,link,color,a,b,width){
    link(model(parent,'stem',color,[0,0,0],[1,1,1]),a,b,width);
  }

  function branch(parent,link,color,base,bend,tip,width) {
    drawLink(parent,link,color,base,bend,width);
    drawLink(parent,link,color,bend,tip,width*.68);
    const twig=bend.clone().lerp(tip,.45);
    drawLink(parent,link,color,twig,twig.clone().add(new Vector3(width*3,width*5,-width*4)),width*.43);
  }

  function tree(root,kind,size,seed,link) {
    const random=Land.rng(seed);
    root.scale.setScalar(size);
    const h=.84+random()*.26, lean=.19*(random()-.5);
    if(kind==='birch'){
      const feet=new Vector3(), fork=new Vector3(.025,h*.44,.015), tip=new Vector3(-.08+lean,h*.99,.041);
      drawLink(root,link,birch,feet,fork,.043);
      drawLink(root,link,'#b2bfc9',fork,tip,.034);
      for(let i=0;i<5;i++){
        const y=.16+i*.116, x=.026-y*.058;
        model(root,'box','#45535f',[x,y,.034],[.041-i*.003,.012+i%2*.012,.011],[.13,i*.34,.25-i*.095]);
      }
      branch(root,link,birch,fork,new Vector3(.157,h*.66,-.041),new Vector3(.255,h*1.02,-.054),.026);
      branch(root,link,'#8195a5',tip.clone().lerp(fork,.45),new Vector3(-.208,h*.81,.004),
        new Vector3(-.272,h*.96,.067),.018);
      branch(root,link,shade,new Vector3(.085,h*.53,-.01),new Vector3(.095,h*.67,-.12),
        new Vector3(.039,h*.83,-.19),.014);
      return;
    }
    if(kind==='pine'){
      const fork=new Vector3(-.043,h*.54,0);
      drawLink(root,link,'#3d454c',new Vector3(),fork,.065);
      for(let i=0;i<4;i++){
        const angle=i*2.39996+random()*.42;
        const spread=i===2?.28:.19+.05*random();
        const x=Math.cos(angle)*spread+lean,z=Math.sin(angle)*spread;
        const y=h*(.59+.115*i);
        drawLink(root,link,'#40535b',fork,new Vector3(x,y,z),.026);
        model(root,'pebble',leaves[i%3],[x,y,z],[.163,.104+.019*random(),.13],[.12,angle,.19]);
        model(root,'pebble',snow[i%3],[x+.018,y+.084,z+.010],[.120,.050,.099],[.21,angle,-.15]);
      }
      return;
    }
    if(kind==='snag'){
      const split=new Vector3(.035,.42*h,.022), top=new Vector3(-.044+lean,.81*h,-.034);
      drawLink(root,link,'#3b4c5b',new Vector3(),split,.064);
      drawLink(root,link,'#46596a',split,top,.047);
      branch(root,link,'#4a5d6c',split,new Vector3(.146,.55*h,.033),new Vector3(.24,.63*h,.078),.024);
      branch(root,link,'#476071',split.clone().lerp(top,.45),new Vector3(-.152,.63*h,-.026),
        new Vector3(-.206,.80*h,.025),.019);
      model(root,'pebble',snow[0],[top.x,.81*h+.025,top.z],[.048,.029,.041],[.25,0,.19]);
      return;
    }
    const tall=kind==='fir';
    const powdered=kind==='snowy';
    const evergreen=kind==='evergreen';
    drawLink(root,link,'#384652',new Vector3(),new Vector3(lean,h*1.18,-.055),tall?.052:.064);
    const count=tall?4:3;
    for(let i=0;i<count;i++){
      const y=h*((tall?.51:.38)+i*(tall?.20:.30));
      const width=(tall?.183:.315)*(1-i/(count+.29)*.81)*(1+.13*(random()-.5));
      const dx=lean*(.32+i*.20)+.039*Math.sin(i*4+seed), dz=.045*(random()-.45);
      const yaw=random()*Land.tau, tilt=.27*(random()-.50);
      model(root,'firCrown',(powdered || evergreen?needles:leaves)[i%3],[dx,y,dz],
        [width,.47*h,width*(.84+random()*.18)],[0,yaw,tilt]);
      model(root,'firCrown',powdered?'#d4e3e4':snow[i%3],[dx+.024*Math.cos(yaw),y+h*.090,dz+.035*Math.sin(yaw)],
        [width*(powdered?.94:.82),h*(powdered?.42:.357),width*(powdered?.92:.78)],[.06*Math.cos(i),yaw,tilt-.04]);
    }
  }

  function undergrowth(root,kind,seed,link){
    const random=Land.rng(seed);
    const count=kind==='berry'?5:kind==='ice'?4:7;
    for(let i=0;i<count;i++){
      const a=i*2.39996, r=.011+random()*.13;
      const x=Math.cos(a)*r,z=Math.sin(a)*r;
      const h=(kind==='berry'?.15:.09)+random()*.12;
      const base=new Vector3(x,0,z), tip=new Vector3(x+Math.cos(a)*.051,h,z+Math.sin(a)*.052);
      if(kind==='ice') {
        model(root,icicle,['#72a4bc','#83b4c9','#9abdc8'][i%3],[x,h*.43,z],[.021,h,.022],
          [Math.sin(a)*.27,0,Math.cos(a)*.32]);
      } else {
        drawLink(root,link,kind==='berry'?'#726270':'#9a9892',base,tip,.007+i%2*.004);
        if(kind==='berry'){
          model(root,'tiny',i%2===0?'#ae645f':'#94595b',tip.toArray(),[.031,.028,.028]);
          model(root,'tiny','#d0d5d5',[tip.x-.006,tip.y+.018,tip.z],[.019,.010,.018]);
        } else if(i%2===0) {
          model(root,'pebble','#b9b5a8',tip.toArray(),[.018,.034,.014],[.3,a,.18]);
        }
      }
    }
  }

  const iceAxis=Land.direction(1.39,-1.02), iceFrame=Land.frame(1.39,-1.02).rotation;
  const iceEast=new Vector3(1,0,0).applyQuaternion(iceFrame);
  const iceSouth=new Vector3(0,0,1).applyQuaternion(iceFrame);
  const crests=[
    [-1.89,-.32,.23,1.15],[-.22,-1.08,.20,.91],[.83,.46,.29,1.33],
    [-2.45,.65,.26,1.11],[2.56,.48,.19,.95],[-.69,.09,.19,1.11]
  ].map(([lon,lat,raise,width],i)=>{
    const frame=Land.frame(lon,lat).rotation;
    return {
      axis:Land.direction(lon,lat), x:new Vector3(1,0,0).applyQuaternion(frame),
      z:new Vector3(0,0,1).applyQuaternion(frame), raise,width,turn:i*.27-.58
    };
  });
  const lakeBlue=new THREE.Color('#78acc6'), lakeWhite=new THREE.Color('#9abeca');
  const {smoothstep}=THREE.MathUtils;

  function iceRatio(x,z) {
    const u=x/.88,v=z/.76;
    const angle=Math.atan2(v,u);
    return Math.hypot(u,v)/(.98+.092*Math.sin(3*angle+.54)+.081*Math.cos(5*angle-.23));
  }

  function lakeCoordinates(normal) {
    return [2.56*iceEast.dot(normal),2.56*iceSouth.dot(normal)];
  }

  function relief(normal,color) {
    let height=0;
    for(const {axis,x,z,raise,width,turn} of crests){
      if(normal.dot(axis)<.86) continue;
      const u=x.dot(normal)*2.56, v=z.dot(normal)*2.56;
      const curve=u+v*turn+.18*Math.sin(v*3.0);
      const shoulder=1-smoothstep(Math.abs(curve),.10,.67);
      const length=1-smoothstep(Math.abs(v),.20,width);
      const pillows=.81+.19*Math.cos(v*12.2+u*5.1);
      height+=raise*shoulder*length*pillows;
    }
    if(normal.dot(iceAxis)<.87) return height;
    const [x,z]=lakeCoordinates(normal);
    const ratio=iceRatio(x,z);
    const basin=1-smoothstep(ratio,.89,1.15);
    const ledge=(smoothstep(ratio,.92,1.15)-smoothstep(ratio,1.24,1.60))*(.105+.035*Math.sin(x*19.6+z*7));
    const crust=.60+.39*Math.sin(9*x+3*z)*Math.sin(11*z+2*x);
    color.lerp(lakeBlue,.89*basin).lerp(lakeWhite,.34*crust*basin);
    return height-.156*basin+ledge;
  }

  function fillForest(parent,{plant,clear,link}) {
    const random=Land.rng(84910);
    const groups=[
      [-.29,-.56,16,1],[-.38,-1.01,18,0],[.68,-1.18,18,0],[-1.86,-.66,17,2],
      [-2.81,-.21,16,0],[-2.74,.66,19,0],[2.78,.46,16,2],[2.34,-.42,16,0],
      [1.24,.56,20,0],[-1.57,.36,16,1],[-.24,.31,18,1],[.77,-.40,19,2],
      [1.84,-.86,17,0],[-2.47,.28,17,2],[2.10,.78,17,0]
    ];
    const used=[];
    for(const [g,[lon,lat,count,grove]] of groups.entries()) {
      const axis=Land.direction(lon,lat), frame=Land.frame(lon,lat).rotation;
      const east=new Vector3(1,0,0).applyQuaternion(frame), south=new Vector3(0,0,1).applyQuaternion(frame);
      for(let i=0;i<count;i++){
        const angle=(i+g*.43)*2.39996;
        const r=.028+Math.sqrt(i/count)*(.188+.046*Math.sin(g*12.16));
        const normal=axis.clone().addScaledVector(east,Math.cos(angle)*r).addScaledVector(south,Math.sin(angle)*r).normalize();
        if(normal.dot(iceAxis)>.90 && iceRatio(...lakeCoordinates(normal))<1.13) continue;
        const isSeedling=i%5!==3;
        const radius=isSeedling?.13:.069;
        if(!clear(normal,radius) || used.some(n=>n.dot(normal)>Math.cos(isSeedling?.072:.057))) continue;
        used.push(normal);
        const patch=plant(parent,normal,angle*.83);
        if(isSeedling) {
          const kinds=grove===0?['snowy','evergreen','snowy','pine']:grove===1?['birch','evergreen','pine','snowy']:
            ['evergreen','snowy','pine','snag'];
          tree(patch,kinds[i%kinds.length],.29+.33*random(),907+i*775+g*684,link);
        } else {
          undergrowth(patch,['ice','grass','berry'][(i+g)%3],850+i*375+g*511,link);
        }
      }
    }
  }

  return {tree,undergrowth,relief,fillForest};
})();

;
const FrostValley=(()=>{
  const {Color,Group,Vector3}=THREE;
  const {model,batchRepeatedParts}=Scenery;
  const {lerp,smoothstep}=THREE.MathUtils;
  const lon=1.44, lat=-.22;
  const center=z=>.15+.18*Math.sin(2.7*z+.36)-z*.11+.07*Math.sin(5.1*z-.42);
  const width=z=>.109+.053*Math.sin((z+.47)*2.5)**2+.088*Math.exp(-16*(z-.98)**2);
  const end=z=>1-smoothstep(Math.abs(z+.03),1.04,1.40);
  const wood=['#956d57','#b18464','#a87657'];
  const cream='#d3e3e7', frost='#b0c9d5';
  const amber=new THREE.MeshStandardMaterial({color:'#ffe5ad',emissive:'#f6b164',emissiveIntensity:.72});
  const lightSnow=new Color('#cfdee1'), deepIce=new Color('#559bb8');
  const postSnow='#c5d6da';

  function shape(x,z) {
    const edge=Math.hypot((x+.08*z)/1.37,(z+.07)/1.45);
    const reach=1-smoothstep(edge,.73,1.10);
    const delta=x-center(z), w=width(z);
    const channel=(1-smoothstep(Math.abs(delta),.47*w,1.51*w))*end(z);
    const upper=.36*Math.exp(-((x+.77+.16*z)**2*6+(z+.47)**2*2.8));
    const lower=.29*Math.exp(-((x-.74+.25*z)**2*5+(z-.46)**2*3));
    const path=Math.abs(delta+.52+.13*Math.sin(3*z+.4));
    const cornice=(smoothstep(-delta,.29,.47)-smoothstep(-delta,.54,.76))*
      (.079+.027*Math.sin(z*15.0))*end(z+.20);
    const dunes=.057*Math.sin(8.4*x-2.1*z)*Math.sin(4.6*z-.7*x);
    const texture=.028*Math.sin(z*32.9+x*7.7)*Math.cos(x*22.3-z*4.8);
    return {raise:reach*(upper+lower+cornice+dunes+texture-.285*channel),ice:reach*channel,
      tint:reach*(.74-.28*(1-smoothstep(path,.028,.103)))};
  }

  function tintSurface(color,{tint,ice}) {
    return color.lerp(lightSnow,tint).lerp(deepIce,Math.pow(ice,.58)*.93);
  }

  function spot(parent,x,y,z){
    const root=new Group();
    root.position.set(x,y,z);
    parent.add(root);
    return root;
  }

  function channelFloor(root,ground) {
    const geometry=new THREE.BufferGeometry(), positions=[];
    const random=Land.rng(14071);
    for(let i=0;i<22;i++){
      const z=-.95+i*.096, x=center(z)+width(z)*.31*(random()-.5);
      const dx=.022+random()*.055, dz=.020+random()*.051;
      for(const [a,b] of [[x-dx,z+dz],[x,z],[x,z],[x+dx*.69,z-dz*.53]]) {
        positions.push(a,ground(a,b)+.016,b);
      }
    }
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const ice=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#a0cfdf',transparent:true,opacity:.28,depthWrite:false}));
    ice.name='Извилистое ледовое русло';
    root.add(ice);
  }

  function cabin(root,style,scale) {
    root.scale.setScalar(scale);
    const side=style==='lodge'?.195:.158, depth=style==='shed'?.137:.174;
    const wall=style==='shed'?.183:.251, slope=style==='shed'?.61:.79;
    model(root,'box','#617486',[0,-.027,0],[side*1.97,.113,depth*2.0]);
    model(root,'box',wood[2],[0,wall*.5,0],[side*2,wall,depth*2]);
    for(let i=0;i<5;i++){
      const y=wall*(.098+i*.193);
      model(root,'box',wood[i%wood.length],[0,y,depth],[side*2.03,.035,.020]);
      model(root,'box',wood[(i+1)%wood.length],[side,y,0],[.019,.034,depth*2]);
    }
    for(const sign of [-1,1]) {
      const beam=side*.73, ridge=wall+side*Math.tan(slope)*.53;
      model(root,'box','#685e5b',[sign*beam*.69,ridge,0],[side*1.59,.040,depth*2+.084],[0,0,-sign*slope]);
      model(root,'box',cream,[sign*beam*.70,ridge+.032,-.008],[side*1.60,.056,depth*2+.094],[0,0,-sign*slope]);
      model(root,'pebble',frost,[sign*(side+.026),ridge-.057,depth*.57],[.057,.038,.082],[.15,0,-sign*.20]);
    }
    const gable=new THREE.ConeGeometry(1,1,4);
    model(root,gable,wood[1],[0,wall+.025,0],[side*1.02,.154,depth*1.38],[0,Math.PI/4,0]);
    model(root,'box','#625750',[-side*.37,wall*.35,depth+.013],[.075,wall*.65,.021]);
    model(root,'box',wood[0],[-side*.38,.008,depth+.052],[.126,.027,.09]);
    model(root,'box',postSnow,[-side*.38,.027,depth+.052],[.123,.020,.091]);
    model(root,'box','#705d55',[side*.43,wall*.56,depth+.010],[.126,.092,.021]);
    model(root,'box',amber,[side*.43,wall*.56,depth+.023],[.099,.065,.009]);
    for(const [w,h] of [[.105,.008],[.008,.071]]) model(root,'box','#9b775d',[side*.43,wall*.56,depth+.031],[w,h,.008]);
    model(root,'box',amber,[side+.011,wall*.57,-.034],[.013,.072,.092]);
    model(root,'box','#8f7772',[-side*.48,wall+.138,-depth*.53],[.076,.181,.072]);
    model(root,'box','#bbcbd1',[-side*.48,wall+.236,-depth*.53],[.095,.034,.093]);
    return new Vector3(-side*.48,wall+.257,-depth*.53);
  }

  function bridge(root,ground,link,z,narrow) {
    const cx=center(z);
    const half=width(z)+(narrow?.178:.241);
    const radius=narrow?.108:.165;
    const left=cx-half,right=cx+half;
    const bottom=ground(left,z)+.050, top=ground(right,z)+.050;
    const deck=u=>lerp(bottom,top,u)+(narrow?.083:.131)*Math.sin(u*Math.PI);
    const steps=narrow?8:12;
    for(let j=0;j<steps;j++){
      const u=(j+.5)/steps, x=lerp(left,right,u), y=deck(u);
      const angle=Math.atan2(deck((j+1)/steps)-deck(j/steps),2*half/steps);
      model(root,'box',wood[j%wood.length],[x,y,z],[2*half/steps-.005,.037,2*radius],[0,0,angle]);
      if(j%3===0) model(root,'box',frost,[x,y+.021,z+radius*.62],[2*half/steps-.008,.013,radius*.52],[0,0,angle]);
    }
    if(narrow) return;
    const yRail=.162;
    for(const side of [-1,1]) {
      const depth=z+side*radius*.89;
      let start;
      for(let i=0;i<5;i++){
        const u=i/4,x=lerp(left,right,u),y=deck(u)+yRail;
        const end=new Vector3(x,y,depth);
        model(root,'box','#7a655d',[x,y-yRail*.51,depth],[.037,yRail+.055,.037],[0,0,.08*(.5-u)]);
        model(root,'pebble',cream,[x,y+.015,depth],[.039,.021,.035]);
        if(start) link(model(root,'stem','#9c8170',[0,0,0],[1,1,1]),start,end,.021);
        start=end;
      }
    }
  }

  function chimney(parent,point,aura) {
    const puffs=Array.from({length:4},(_,i)=>{
      const puff=aura(parent,i%2===0?'#e0ddce':'#bfc9d1',0,false);
      puff.renderOrder=3;
      return puff;
    });
    return t=>{
      for(const [i,puff] of puffs.entries()){
        const phase=(t*.26+i/puffs.length)%1;
        puff.position.set(point.x+.17*phase+.04*Math.sin(phase*6+i)*phase,
          point.y+.44*phase,point.z-.08*phase);
        puff.scale.setScalar(.082+.18*phase);
        puff.material.opacity=.28*Math.sin(Math.PI*phase);
      }
    };
  }

  function create(root,{ground,link,aura,occupied}) {
    root.name='Ледовая долина с зимними домами';
    channelFloor(root,ground);
    const scenery=spot(root,0,0,0), cabinLocations=[], crossingLocations=[];
    const clears=(x,z,r)=>!occupied(x,z,r) && cabinLocations.every(h=>Math.hypot(h.x-x,h.z-z)>h.r+r);
    const runs=[];
    const houses=[
      {kind:'lodge',size:1.17,angle:.17,options:[[-.69,-.46],[-.70,-.68],[-.83,-.29],[-.57,-.91],[-.96,-.38],[-1.05,-.62]]},
      {kind:'cabin',size:1.02,angle:-.19,options:[[.73,-.41],[.67,-.69],[.82,-.34],[.71,-.83],[1.02,-.33],[1.14,-.70]]},
      {kind:'shed',size:.83,angle:.45,options:[[-.77,.34],[-.96,.33],[-.70,.56],[-.64,.78],[-1.04,.57],[-1.19,.36]]},
      {kind:'cabin',size:1.05,angle:-.40,options:[[.71,.64],[.91,.43],[.72,.77],[.56,.97],[1.02,.76],[1.14,.34],[1.00,.12],[.98,-.02]]}
    ];
    for(const [i,house] of houses.entries()){
      const radius=.27*house.size;
      const side=i%2===0?-1:1;
      const fallback=[.38,.17,.65,.91,-.13,-.44,-.72,-.98,1.10].flatMap(z=>
        [.64,.82,1.01,1.17].map(x=>[x*side,z]));
      const found=[...house.options,...fallback].find(([x,z])=>clears(x,z,radius) &&
        Math.abs(x-center(z))>width(z)+radius+.10);
      if(!found) continue;
      const [x,z]=found;
      cabinLocations.push({x,z,r:radius});
      const home=spot(scenery,x,ground(x,z)-.020,z);
      home.name='Заснеженный домик '+(i+1);
      home.rotation.y=house.angle;
      const tip=cabin(home,house.kind,house.size);
      runs.push(chimney(home,tip,aura));
      const porch=spot(scenery,x+.22,ground(x+.22,z+.32),z+.32);
      model(porch,'box','#6e665c',[0,.039,0],[.108,.068,.10]);
      model(porch,'box',postSnow,[0,.078,0],[.118,.018,.110]);
    }
    const extraCrossings=Array.from({length:53},(_,i)=>-.99+.040*i);
    for(const [i,list] of [[0,[-.22,.01,-.46,.17,-.66,.41]],[1,[.81,.96,.49,.61,.37,.28,-.79,-.88,-.97,1.06,1.14]]]){
      const landing=[...list,...extraCrossings].find(z=>crossingLocations.every(other=>Math.abs(z-other)>.37) &&
        [-1,-.5,0,.5,1].every(d=>clears(center(z)+d*(width(z)+(i===0?.241:.178)),z,i===0?.102:.088)));
      if(landing===undefined) continue;
      const pass=spot(scenery,0,0,0);
      pass.name=i===0?'Арочный мост через лед':'Дощатый мостик через лед';
      bridge(pass,ground,link,landing,i===1);
      crossingLocations.push(landing);
    }

    const copse=spot(scenery,0,0,0);
    const random=Land.rng(41066);
    const placed=[];
    for(const [index,[cx,cz,n]] of [[-.97,-.66,8],[.96,-.61,7],[-.84,.53,9],[.96,.68,8],
      [-.42,-.97,5],[.58,.31,5],[-1.14,.19,10],[-1.00,.91,9],[.83,.96,10],[-.46,.96,7],[1.08,.20,9]].entries()){
      for(let i=0;i<n*2;i++){
        const angle=i*2.399963, reach=.09+.23*Math.sqrt(i/(2*n));
        const x=cx+Math.cos(angle)*reach,z=cz+Math.sin(angle)*reach;
        if(Math.abs(x-center(z))<width(z)+.145 || !clears(x,z,.115) ||
          placed.some(p=>Math.hypot(p.x-x,p.z-z)<.15) || crossingLocations.some(v=>Math.abs(z-v)<.20 && Math.abs(x-center(z))<.48)) continue;
        const bush=spot(copse,x,ground(x,z)-.008,z);
        const kind=i%9===3?'birch':i%7===1?'pine':i%3===1?'evergreen':'snowy';
        const scale=.27+.30*random();
        bush.rotation.y=angle*.56;
        FrostVegetation.tree(bush,kind,scale,index*3119+i*472,link);
        placed.push({x,z});
      }
    }

    const rail=spot(scenery,0,0,0);
    rail.name='Ограда у снежного уступа';
    let prior;
    for(let i=0;i<9;i++){
      const z=-.85+i*.149, x=center(z)-.58-.08*Math.sin(z*3.6);
      const y=ground(x,z);
      if(!clears(x,z,.065) || crossingLocations.some(v=>Math.abs(z-v)<.16)) {
        prior=undefined;
        continue;
      }
      model(rail,'box','#776967',[x,y+.078,z],[.030,.166,.035],[0,0,.06]);
      model(rail,'pebble',cream,[x,y+.17,z],[.035,.020,.035]);
      const end=new Vector3(x,y+.122,z);
      if(prior) link(model(rail,'stem','#9c8276',[0,0,0],[1,1,1]),prior,end,.016);
      prior=end;
    }

    for(const [i,[x,z,kind]] of [[-.42,.87,'berry'],[.37,-.7,'ice'],[.34,.67,'ice'],[-.58,.14,'grass'],[.53,-.85,'grass'],
      [-1.08,.35,'berry'],[.52,.86,'grass'],[-.64,-.83,'ice']].entries()){
      if(!clears(x,z,.105)) continue;
      const plants=spot(scenery,x,ground(x,z),z);
      FrostVegetation.undergrowth(plants,kind,4800+911*i,link);
    }
    const fill=new THREE.PointLight('#cfebff',.27,2.60,2);
    fill.position.set(-.30,1.47,.54);
    const warm=new THREE.PointLight('#ffce91',.21,1.45,2);
    const first=cabinLocations[0];
    if(first) warm.position.set(first.x+.10,ground(first.x,first.z)+.42,first.z+.29);
    root.add(fill,warm);
    batchRepeatedParts(scenery);
    return (seconds,visible)=>{
      fill.visible=visible;
      warm.visible=visible && Boolean(first);
      if(visible) runs.forEach(update=>update(seconds));
    };
  }

  return {lon,lat,shape,tintSurface,create};
})();

;
const FrostEncounter=(()=>{
  const {Group,Mesh,Vector3}=THREE;
  const {clamp,lerp,smoothstep}=THREE.MathUtils;
  const {model,batchRepeatedParts}=Scenery;
  const up=new Vector3(0,1,0);
  const cycle=18.4, bladeLength=.61;

  function scenery(stage,link,ground) {
    const set=new Group();
    stage.add(set);
    for(const [i,[x,z,kind,size]] of [
      [-1.08,-.58,'birch',1.25],[-.74,-.79,'pine',.78],[-.36,-.96,'fir',1.26],
      [.09,-1.00,'snag',.90],[.59,-.93,'spruce',1.12],[.98,-.66,'birch',1.38]
    ].entries()){
      const tree=new Group();
      tree.position.set(x,-.016,z);
      tree.rotation.y=.26+i*.73;
      set.add(tree);
      FrostVegetation.tree(tree,kind,size,2205+i*1523,link);
    }
    for(const [i,[x,z,kind]] of [[-.95,.40,'berry'],[.89,.51,'ice'],[-.623,-.57,'grass'],[.28,-.68,'berry']].entries()){
      const patch=new Group();
      patch.position.set(x,0,z);
      set.add(patch);
      FrostVegetation.undergrowth(patch,kind,912+i*641,link);
    }
    for(const [i,[x,z,angle]] of [[-.83,-.56,-.12],[.76,-.57,.14],[1.055,-.27,.32],[-1.01,.23,-.48]].entries()) {
      const ruins=new Group();
      ruins.position.set(x,.004,z);
      ruins.rotation.z=angle;
      set.add(ruins);
      model(ruins,'box','#617487',[0,.049,0],[.259,.096,.221],[0,angle*.5,.03]);
      model(ruins,'box','#536578',[0,.176,-.016],[.171,.167,.181],[.06,-angle,0]);
      if(i!==3) model(ruins,'pebble','#8aa6b8',[.012,.296,-.005],[.133,.082,.125],[.13,angle,.12]);
      model(ruins,'pebble','#b1c7d1',[.034,i===3?.242:.365,.022],[.113,.031,.092],[.19,.24,.07]);
    }
    for(const [i,[x,z,size]] of [[-.89,.60,.14],[.87,.49,.127],[-.62,.63,.095],[.58,-.66,.086],
      [.15,-.73,.13],[-.23,-.68,.08],[1.05,.072,.15],[-1.09,-.081,.12]].entries()) {
      model(set,'pebble','#788fa4',[x,.025,z],[size,.054,size*.62],[.17,i*.39,.13]);
      model(set,'pebble','#aac0cd',[x+.014,.053,z+.010],[size*.79,.039,size*.54],[.19,i*.37,.15]);
    }
    for(const side of [-1,1]) {
      const shard=new THREE.ConeGeometry(.064,.27,5);
      for(let i=0;i<3;i++) model(set,shard,i===1?'#71a7bf':'#7a94ad',[side*(1.01+i*.056),.085-i*.014,.35+i*.058],
        [.93-i*.16,1-i*.17,.79],[.22*i,0,-side*(.14+i*.17)]);
    }
    for(const part of set.children) part.position.y+=ground(part.position.x,part.position.z);
    batchRepeatedParts(set);
  }

  const frame=(t,x,z,lift,bend,yaw,grip,aim,target=null)=>({t,x,z,lift,bend,yaw,grip,aim,target});
  const rest=frame(0,-.05,.315,0,.012,-.22,[.10,.29,.09],[.71,.55,.10]);
  const route=[
    rest,frame(.42,-.090,.288,0,.047,-.58,[.095,.32,.09],[-.65,.54,.10]),
    frame(1.09,-.20,.280,0,.042,-.84,[.041,.33,.075],[-.44,.57,.26],[-.346,.466,.372]),
    frame(1.34,-.21,.30,0,.039,-.55,[.077,.27,.10],[-.08,.84,.47]),
    frame(1.80,-.105,.353,0,.072,.38,[.115,.285,.092],[.30,.94,.13]),
    frame(2.09,-.071,.311,0,.03,.68,[.132,.34,.033],[.58,.54,.24],[.21,.482,.39]),
    frame(2.38,.064,.269,0,.085,.94,[.139,.295,.026],[.46,.68,.21]),
    frame(2.69,.285,.164,.386,.02,1.21,[.114,.296,.061],[.85,.33,.21]),
    frame(2.98,.496,.065,.287,.012,1.29,[.142,.270,.018],[.96,.10,.15],[.69,.482,.021]),
    frame(3.32,.526,.181,0,.102,.86,[.114,.278,.044],[.62,.34,.50]),
    frame(3.65,.402,.275,0,.032,-.23,[.108,.32,.079],[-.20,.84,.39]),
    frame(4.12,.225,.386,0,.042,-.82,[.088,.32,.088],[-.51,.51,.56]),
    frame(4.66,.148,.339,0,.029,-.69,[.055,.32,.061],[-.61,.61,.09],[-.054,.459,.337]),
    frame(5.02,.087,.271,0,.052,-.70,[.105,.29,.10],[-.73,.29,.65]),
    frame(5.62,-.048,.344,0,.062,.71,[.14,.31,.018],[.69,.62,.18]),
    frame(6.02,-.04,.302,0,.038,.62,[.112,.32,.08],[.58,.67,.24],[.289,.507,.358]),
    frame(6.47,-.146,.379,0,.087,-.82,[.088,.27,.12],[-.57,.51,.39]),
    frame(6.83,-.318,.238,.338,.013,-1.13,[.033,.31,.099],[-.83,.26,.42]),
    frame(7.14,-.526,.068,.253,.026,-1.37,[.008,.276,.069],[-.89,.20,.15],[-.702,.447,-.06]),
    frame(7.48,-.550,.226,0,.102,-1.11,[.005,.26,.109],[-.63,.35,.66]),
    frame(7.88,-.438,.325,0,.032,.18,[.116,.30,.094],[.24,.82,.37]),
    frame(8.48,-.296,.349,0,.017,.58,[.117,.31,.101],[.57,.75,.23]),
    frame(9.07,-.167,.394,0,.093,.24,[.103,.21,.093],[.61,.15,.59]),
    frame(9.46,.028,.439,0,.102,-.11,[.098,.203,.111],[.82,.24,.23]),
    frame(9.89,.250,.294,.27,.019,.79,[.134,.29,.071],[.83,.46,.21]),
    frame(10.34,.340,.204,.304,.016,1.12,[.101,.314,.062],[.74,.41,.42]),
    frame(10.73,.233,.273,0,.082,.68,[.122,.278,.092],[.64,.56,.40]),
    frame(11.12,.166,.309,0,.026,-.69,[.076,.34,.137],[-.58,.48,.47],[-.075,.526,.437]),
    frame(11.66,.071,.386,0,.039,.77,[.148,.32,.022],[.62,.75,.06],[.293,.501,.403]),
    frame(12.14,.028,.297,0,.071,.49,[.146,.27,.077],[.91,.18,.23]),
    frame(12.48,-.118,.279,.198,.017,-1.10,[.092,.292,.085],[-.45,.61,.46]),
    frame(12.79,-.21,.242,.095,.047,-1.93,[.068,.294,.081],[-.80,.31,.44]),
    frame(13.2,-.238,.251,0,.087,-.83,[.095,.264,.119],[-.64,.31,.53]),
    frame(13.48,-.122,.375,0,.064,.69,[.112,.316,.031],[.76,.42,.26],[.242,.51,.385]),
    frame(13.75,-.095,.421,0,.060,.28,[.108,.30,.071],[.19,.71,.48]),
    frame(14.04,-.158,.39,0,.075,-.94,[.065,.286,.08],[-.62,.45,.17],[-.348,.41,.427]),
    frame(14.45,-.202,.353,0,.107,-.50,[.058,.248,.101],[-.72,.45,.42]),
    frame(14.78,-.117,.404,.191,.028,.48,[.122,.273,.038],[.77,.41,.42]),
    frame(15.19,.064,.385,.372,.012,1.12,[.131,.302,.039],[.46,.49,.51]),
    frame(15.47,.216,.316,.212,.027,.76,[.102,.276,.086],[.44,.76,.37]),
    frame(15.76,.263,.235,0,.106,.26,[.078,.236,.102],[-.18,.78,.50]),
    frame(16.08,.215,.204,0,.055,-1.01,[.065,.28,.066],[-.66,.45,.35],[.062,.39,.294]),
    frame(16.47,.056,.280,0,.037,-.82,[.081,.31,.083],[-.32,.55,.49]),
    frame(16.91,-.213,.342,0,.092,.36,[.119,.244,.129],[.22,.71,.46]),
    frame(17.26,-.172,.328,0,.048,.86,[.128,.297,.058],[.74,.38,.17],[.247,.485,.34]),
    frame(17.67,.087,.289,0,.069,.56,[.135,.26,.084],[.86,.31,.38]),
    frame(18.03,.004,.252,0,.044,.12,[.132,.27,.064],[.83,.37,.10]),
    {...rest,t:cycle}
  ];
  const droidRoutes=[
    [[0,-.75,-.253],[.66,-.704,-.206],[1.7,-.823,-.07],[2.42,-.829,-.131],[3.64,-.738,-.273],
      [4.25,-.58,-.217],[5.1,-.714,-.12],[6.05,-.726,-.156],[7.14,-.737,-.06],
      [9.05,-.737,-.06],[10.1,-.765,-.16],[10.75,-.67,-.232],[11.6,-.729,-.18],[13.0,-.812,-.224],
      [13.68,-.673,-.103],[14.42,-.79,-.185],[15.63,-.646,-.163],
      [16.10,-.626,-.122],[16.82,-.798,-.181],[17.61,-.845,-.206],[cycle,-.75,-.253]],
    [[0,.765,-.247],[.83,.773,-.193],[1.65,.73,-.046],[2.1,.661,-.080],[2.98,.688,.013],
      [5.05,.688,.013],[5.45,.748,-.064],[6.05,.739,-.12],[7.35,.827,-.214],[8.43,.701,-.23],[9.17,.734,-.18],
      [9.66,.792,-.088],[10.75,.758,-.214],[11.4,.691,-.274],[12.3,.778,-.16],[13.26,.846,-.19],
      [13.79,.814,-.274],[14.86,.694,-.108],[15.52,.83,-.209],
      [16.45,.806,-.244],[16.94,.751,-.136],[17.42,.845,-.192],[cycle,.765,-.247]]
  ];
  const collapses=[[7.15,7.58,8.18,9.32],[3,3.47,4.15,5.24]];

  function sample(t,rows) {
    let i=1;
    while(i<rows.length-1 && t>(rows[i].t ?? rows[i][0])) i++;
    const a=rows[i-1],b=rows[i], start=a.t ?? a[0], end=b.t ?? b[0];
    const raw=clamp((t-start)/(end-start),0,1);
    return {a,b,u:lerp(raw,smoothstep(raw,0,1),.79),span:end-start,raw};
  }

  const tempGrip=new Vector3(), d0=new Vector3(), d1=new Vector3();
  function poseOf(key,grip,out) {
    grip.fromArray(key.grip);
    grip.x+=key.x;
    grip.y+=key.lift;
    grip.z+=key.z;
    return key.target ? out.fromArray(key.target).sub(grip).normalize() : out.fromArray(key.aim).normalize();
  }

  function yodaAt(t,out) {
    const {a,b,u,raw,span}=sample(t,route);
    out.x=lerp(a.x,b.x,u);
    out.z=lerp(a.z,b.z,u);
    out.lift=lerp(a.lift,b.lift,u);
    out.bend=lerp(a.bend,b.bend,u);
    out.yaw=lerp(a.yaw,b.yaw,u);
    out.walk=Math.min(1,Math.hypot(b.x-a.x,b.z-a.z)/span*2.5)*Math.sin(Math.PI*raw)**.7;
    poseOf(a,out.grip,d0);
    poseOf(b,tempGrip,d1);
    out.grip.lerp(tempGrip,u);
    out.dir.copy(d0).lerp(d1,u).normalize();
  }

  function droidAt(index,t,out) {
    const {a,b,u,span,raw}=sample(t,droidRoutes[index]);
    const [hit,down,rise,ready]=collapses[index];
    out.x=lerp(a[1],b[1],u);
    out.z=lerp(a[2],b[2],u);
    out.fall=smoothstep(t,hit,down)-smoothstep(t,rise,ready);
    out.brace=smoothstep(t,rise+.03,rise+.36)-smoothstep(t,ready-.23,ready);
    out.stride=Math.min(1,Math.hypot(b[1]-a[1],b[2]-a[2])/span*3)*Math.sin(Math.PI*raw)**.68;
  }

  const blankPose=()=>({grip:new Vector3(),dir:new Vector3()});
  const earGeometry=new THREE.BufferGeometry();
  earGeometry.setAttribute('position',new THREE.Float32BufferAttribute([
    -.032,.027,.020,.046,.029,.019,.211,.066,-.016,.052,-.051,.020,
    .060,.006,.039,.039,.010,-.032
  ],3));
  earGeometry.setIndex([0,4,1,1,4,2,2,4,3,3,4,0,1,5,0,2,5,1,3,5,2,0,5,3]);
  earGeometry.computeVertexNormals();
  const robeGeo=new THREE.LatheGeometry([[0,0],[.158,0],[.148,.056],[.113,.14],[.089,.239],[0,.245]]
    .map(([x,y])=>new THREE.Vector2(x,y)),13);

  function littleMaster(stage,link) {
    const root=new Group();
    root.name='Мастер Йода';
    stage.add(root);
    const mantle=new Group();
    root.add(mantle);
    model(mantle,robeGeo,'#a9957a',[0,.122,0],[1,1,.87]);
    model(mantle,'pebble','#dac29f',[0,.269,.036],[.076,.109,.059]);
    model(mantle,'round','#7a6a5f',[0,.218,.02],[.113,.023,.074]);
    for(const side of [-1,1]) {
      model(mantle,'box','#bcaa8d',[side*.073,.288,.059],[.042,.147,.020],[0,0,side*.36]);
    }
    const cowl=new Group();
    cowl.position.set(0,.30,-.044);
    mantle.add(cowl);
    model(cowl,'round','#aa907b',[0,-.039,-.035],[.123,.144,.065],[.30,0,-.04]);
    const head=new Group();
    head.position.set(0,.376,.009);
    mantle.add(head);
    model(head,'pebble','#78a76a',[0,.026,0],[.114,.121,.095],[.09,.04,0]);
    model(head,'round','#88ad72',[0,-.019,.024],[.090,.074,.083]);
    model(head,'pebble','#87af74',[0,-.002,.101],[.031,.024,.025],[.14,0,0]);
    model(head,'round','#5b7956',[0,-.042,.094],[.045,.009,.010],[0,0,-.05]);
    for(const side of [-1,1]) {
      const ear=new Group();
      ear.position.set(side*.080,.022,-.002);
      ear.scale.x=side;
      head.add(ear);
      const skin=new THREE.MeshStandardMaterial({color:'#79a16a',side:THREE.DoubleSide,roughness:.87});
      model(ear,earGeometry,skin,[0,0,0],[1,1,1]);
      model(ear,'pebble','#61785c',[.082,.009,.025],[.060,.019,.014],[0,0,.165]);
      model(head,'round','#ccb88c',[side*.044,.018,.083],[.028,.015,.017],[.1,0,side*.12]);
      model(head,'tiny','#2a3e46',[side*.045,.018,.095],[.008,.010,.006]);
      model(head,'round','#78966b',[side*.046,.035,.085],[.036,.014,.012],[0,0,side*.20]);
      model(head,'tiny','#667f5e',[side*.045,.001,.091],[.033,.008,.009],[.12,0,side*.20]);
    }
    model(head,'pebble','#718e67',[0,.102,-.023],[.070,.023,.033],[0,.08,.21]);
    function limb(color, width) {
      return {part:model(root,'stem',color,[0,0,0],[1,1,1]),width};
    }
    const upper=[limb('#baaa8e',.054),limb('#b8a588',.053)];
    const lower=[limb('#c5b095',.052),limb('#bfa787',.050)];
    const palms=[-1,1].map(()=>model(root,'pebble','#8cac73',[0,0,0],[.037,.034,.041]));
    const legs=[-1,1].map(()=>limb('#827964',.056));
    const shoes=[-1,1].map(()=>model(root,'pebble','#819f70',[0,0,0],[.061,.035,.078]));
    const shoulder=new Vector3(), elbow=new Vector3(), foot=new Vector3(), hip=new Vector3(), hand=new Vector3(), spare=new Vector3();
    function pose(time,p) {
      root.position.set(p.x,.010+p.lift,p.z);
      root.rotation.y=p.yaw;
      mantle.position.y=-p.bend*.79;
      mantle.rotation.set(.12+p.bend*2.6,.11*Math.sin(time*2.9),p.walk*.13*Math.sin(time*10.7));
      head.rotation.x=-.076+p.bend*.59;
      head.rotation.z=-.074+p.dir.x*.19;
      cowl.rotation.x=.17+p.walk*.22+p.lift*.49;
      cowl.rotation.z=.22*Math.sin(time*10.2)*(p.walk+p.lift);
      hand.copy(p.grip).sub(root.position).applyAxisAngle(up,-p.yaw);
      spare.set(-.172-.038*p.dir.x,.257+p.lift*.21,.104+.076*Math.sin(time*7.3)*p.walk);
      for(let i=0;i<2;i++) {
        const side=i===0?1:-1;
        const point=i===0?hand:spare;
        shoulder.set(side*.082,.304-p.bend*.77,.001);
        elbow.copy(shoulder).lerp(point,.50);
        elbow.x+=side*.048;
        elbow.y-=.046;
        link(upper[i].part,shoulder,elbow,upper[i].width);
        link(lower[i].part,elbow,point,lower[i].width);
        palms[i].position.copy(point);
        const step=time*11.2+i*Math.PI;
        foot.set(side*(.075+.21*p.bend),.031+Math.max(0,Math.cos(step))*.033*p.walk+.091*p.lift,
          .035+.074*p.walk*Math.sin(step)+side*.24*p.lift);
        hip.set(side*.060,.180-p.bend*.69,-.008);
        link(legs[i].part,hip,foot,legs[i].width);
        shoes[i].position.copy(foot);
      }
    }
    return pose;
  }

  const muzzleOffset=new Vector3(.025,.444,.339);
  function faceDroid(p,yoda) {
    return Math.atan2(yoda.x-p.x,yoda.z-p.z);
  }

  function droid(stage,index,link,aura) {
    const root=new Group();
    root.name=index===0?'Дроид B1 слева':'Дроид B1 справа';
    stage.add(root);
    const frame=new Group();
    root.add(frame);
    const sand=index===0?'#baa383':'#c6ae8b', offset=index===0?'#8f7669':'#997f67';
    const joint='#6e665c', pecan='#a78668';
    const iron='#43495a', silver='#6e7384';
    for(const side of [-1,1]) {
      model(frame,'round',offset,[side*.070,.197,.008],[.061,.048,.051]);
      model(frame,'round',sand,[side*.095,.477,.008],[.056,.056,.053]);
      model(frame,'box',sand,[side*.067,.454,.019],[.068,.100,.117],[0,0,side*.120]);
    }
    model(frame,'pebble',sand,[0,.416,.030],[.115,.086,.083],[.04,0,.12]);
    model(frame,'box','#d0bb96',[0,.427,.103],[.101,.098,.027],[.11,0,-.043]);
    model(frame,'box',joint,[0,.302,.007],[.098,.141,.072],[.09,0,.035]);
    model(frame,'pebble',offset,[0,.214,.026],[.117,.073,.061]);
    model(frame,'box',sand,[0,.218,.068],[.104,.082,.047],[0,0,.12]);
    model(frame,'stem',pecan,[.015,.568,.012],[.024,.150,.023],[.09,0,-.047]);
    model(frame,'box',offset,[-.041,.397,-.089],[.114,.147,.061],[.12,0,.19]);
    model(frame,'stem',joint,[-.081,.510,-.098],[.013,.157,.013],[.26,0,.1]);

    const head=new Group();
    head.name='Удлиненная голова B1';
    head.position.set(0,.636,.018);
    frame.add(head);
    model(head,'round',sand,[0,.026,-.023],[.079,.100,.071],[.23,0,.086]);
    model(head,'pebble',sand,[0,.009,.051],[.065,.073,.128],[.48,0,.033]);
    model(head,'round',offset,[0,-.028,.091],[.056,.058,.104],[.54,0,-.023]);
    model(head,'pebble','#ccb28d',[0,-.015,.102],[.054,.050,.105],[.49,0,-.057]);
    for(const side of [-1,1]) {
      model(head,'round',joint,[side*.053,.037,.047],[.013,.014,.027],[.17,side*.32,side*.36]);
      model(head,'round','#ad947a',[side*.067,.035,-.035],[.030,.032,.047],[0,side*.07,0]);
      model(head,'stem',sand,[side*.055,-.042,-.053],[.013,.119,.016],[.17,0,.14]);
    }

    const gun=new Group();
    gun.position.set(.025,.442,.158);
    frame.add(gun);
    model(gun,'box',iron,[0,0,.017],[.102,.074,.197],[.03,.031,0]);
    model(gun,'round',iron,[0,0,.124],[.048,.043,.077]);
    model(gun,'stem',silver,[0,.004,.172],[.026,.051,.024],[Math.PI/2,0,0]);
    model(gun,'box',silver,[.011,.036,.026],[.063,.027,.103]);
    model(gun,'box',iron,[.013,-.054,-.022],[.039,.074,.044],[.22,0,.095]);
    const gunLight=new THREE.MeshBasicMaterial({color:'#ffb394',toneMapped:false});
    model(gun,'round',gunLight,[0,.001,.181],[.019,.019,.007]);
    const muzzle=aura(gun,'#ff966f',0);
    muzzle.position.set(0,.002,.185);
    muzzle.scale.setScalar(.23);

    function limb(color) {return model(frame,'stem',color,[0,0,0],[1,1,1]);}
    const arms=[-1,1].map(()=>{
      return {upper:limb(sand),lower:limb(offset),joint:model(frame,'round',joint,[0,0,0],[.031,.036,.034]),
        palm:model(frame,'pebble',sand,[0,0,0],[.037,.037,.040])};
    });
    const legs=[-1,1].map(()=>{
      return {upper:limb(sand),lower:limb(sand),joint:model(frame,'round',joint,[0,0,0],[.039,.039,.039]),
        shoe:model(frame,'pebble',offset,[0,0,0],[.045,.029,.081])};
    });
    const start=new Vector3(), elbow=new Vector3(), wrist=new Vector3(), knee=new Vector3(), foot=new Vector3();

    function pose(t,p,yoda,pulse) {
      root.position.set(p.x,.009+p.fall*.072,p.z);
      root.rotation.y=faceDroid(p,yoda)+p.fall*(index===0?-.15:.17);
      frame.rotation.set(-1.39*p.fall+.24*p.brace,.23*p.fall*(index===0?1:-1),.18*p.fall*(index===0?1:-1));
      const trudge=t*13.5+index*1.2;
      head.rotation.x=-.16*p.brace+.27*p.fall+.06*pulse+.049*Math.sin(t*4.34);
      head.rotation.y=.14*p.brace*Math.cos(t*5.5);
      gun.position.z=.158-.043*pulse;
      muzzle.material.opacity=pulse*.91;
      muzzle.visible=pulse>.02;
      muzzle.scale.setScalar(.16+.15*pulse);

      for(let i=0;i<2;i++) {
        const side=i===0?-1:1, stride=trudge+i*Math.PI;
        const hand=arms[i], leg=legs[i];
        const kneel=p.brace*(i===index?1:.45);
        start.set(side*.105,.461,.006);
        elbow.set(side*(.135+.069*p.fall),.334-.081*p.brace,.077+.048*pulse);
        wrist.set(side*.034+.016,.412-.215*p.fall-.225*p.brace,.194+.045*i-pulse*.036-.064*p.fall);
        link(hand.upper,start,elbow,.037,.029);
        link(hand.lower,elbow,wrist,.030,.027);
        hand.joint.position.copy(elbow);
        hand.palm.position.copy(wrist);
        start.set(side*.062,.197,-.005);
        knee.set(side*(.070+.046*p.fall),.114+.064*kneel,.024+.19*p.fall-.054*p.stride*Math.cos(stride));
        foot.set(side*(.073+.048*p.fall),.029+.059*p.stride*Math.max(0,Math.sin(stride))+.027*kneel,
          .015+.096*p.stride*Math.cos(stride)+.074*p.fall-.037*kneel);
        link(leg.upper,start,knee,.040,.034);
        link(leg.lower,knee,foot,.031,.031);
        leg.joint.position.copy(knee);
        leg.shoe.position.copy(foot);
        leg.shoe.rotation.x=.13*p.stride*Math.cos(stride)+.27*p.fall;
      }
    }

    return pose;
  }

  function greenBlade(stage,link,aura) {
    const group=new Group();
    group.name='Зеленый световой меч Йоды';
    stage.add(group);
    const body=model(group,'stem','#546879',[0,0,0],[1,1,1]);
    const hood=model(group,'stem','#a5b0b0',[0,0,0],[1,1,1]);
    const blade=model(group,'stem',new THREE.MeshBasicMaterial({color:'#eaffdb',toneMapped:false}),[0,0,0],[1,1,1]);
    blade.name='Лезвие Йоды';
    blade.castShadow=false;
    const strips=Array.from({length:7},()=>aura(group,'#9af982',.57));
    const light=new THREE.PointLight('#91f87c',.31,.82,2);
    group.add(light);
    const tip=new Vector3(), start=new Vector3(), collar=new Vector3(), end=new Vector3(), history=new Vector3();
    const samplePose=blankPose();
    const material=new THREE.ShaderMaterial({
      uniforms:{tint:{value:new THREE.Color('#9bf5a2')},opacity:{value:0}},
      vertexShader:`
        attribute float weight;
        varying float intensity;
        void main(){ intensity=weight; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }
      `,
      fragmentShader:`
        uniform vec3 tint;
        uniform float opacity;
        varying float intensity;
        void main(){ gl_FragColor=vec4(tint,opacity*intensity); }
      `,
      transparent:true,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,depthWrite:false,toneMapped:false
    });
    const position=new THREE.BufferAttribute(new Float32Array(9*3*3),3);
    const weight=[], triangles=[];
    for(let i=0;i<9;i++) for(let j=0;j<3;j++) {
      const k=i*3+j;
      weight.push((1-i/8)**1.7*j/2);
      if(i<8 && j<2) triangles.push(k,k+1,k+3,k+1,k+4,k+3);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',position);
    geometry.setAttribute('weight',new THREE.Float32BufferAttribute(weight,1));
    geometry.setIndex(triangles);
    const ribbon=new Mesh(geometry,material);
    ribbon.frustumCulled=false;
    group.add(ribbon);

    return (t,p,flash)=>{
      start.copy(p.grip).addScaledVector(p.dir,-.073);
      collar.copy(p.grip).addScaledVector(p.dir,.063);
      tip.copy(p.grip).addScaledVector(p.dir,bladeLength);
      link(body,start,collar,.033,.032);
      link(hood,end.copy(collar).addScaledVector(p.dir,-.022),collar,.039,.038);
      link(blade,collar,tip,.014,.014);
      for(const [i,strip] of strips.entries()) {
        strip.position.copy(collar).lerp(tip,(i+.5)/strips.length);
        strip.material.opacity=.50+.12*flash;
        strip.scale.setScalar(.108+.017*Math.sin(t*14+i)+.035*flash);
      }
      light.position.copy(collar).lerp(tip,.44);
      light.position.y=lerp(.23,light.position.y,.27);
      light.intensity=.29+.24*flash;
      yodaAt((t+cycle-.14)%cycle,samplePose);
      history.copy(samplePose.grip).addScaledVector(samplePose.dir,bladeLength);
      const speed=smoothstep(history.distanceTo(tip),.055,.36);
      ribbon.visible=speed>.01;
      if(!ribbon.visible) return;
      material.uniforms.opacity.value=.72*speed;
      for(let i=0;i<9;i++) {
        yodaAt((t+cycle-i*.018)%cycle,samplePose);
        for(let j=0;j<3;j++) {
          history.copy(samplePose.grip).addScaledVector(samplePose.dir,[.21,.43,bladeLength][j]);
          position.setXYZ(i*3+j,history.x,history.y,history.z);
        }
      }
      position.needsUpdate=true;
    };
  }

  const shots=[
    [.77,1.09,0,[-.346,.466,.372],[-1.24,.88,.66]],
    [1.72,2.09,1,[.21,.482,.39],[1.20,1.19,.52]],
    [2.25,2.51,0,[.617,.570,.212],[1.39,.59,.044],false],
    [4.33,4.66,0,[-.054,.459,.337],[-.40,1.35,.06]],
    [5.67,6.02,1,[.289,.507,.358],[1.26,.31,.57]],
    [6.25,6.58,0,[.170,.450,.29],[.95,.41,.46],false],
    [8.78,9.10,1,[-.11,.556,.413],[-1.35,.67,.59],false],
    [9.38,9.73,1,[-.11,.395,.244],[-.98,.313,.15],false],
    [10.79,11.12,0,[-.075,.526,.437],[-1.42,.91,.82]],
    [11.31,11.66,1,[.293,.501,.403],[1.42,1.10,.68]],
    [13.15,13.48,1,[.242,.51,.385],[.98,.32,.76]],
    [13.68,14.04,0,[-.348,.41,.427],[-1.24,.97,.17]],
    [14.85,15.19,1,[.064,.248,.385],[-1.19,.245,.49],false],
    [15.72,16.08,0,[.062,.39,.294],[-1.18,.84,.66]],
    [16.92,17.26,1,[.247,.485,.34],[1.19,1.16,.47]]
  ];

  function energy(stage,link,aura) {
    const bot={}, hero=blankPose();
    const events=shots.map(([start,hit,index,target,end,reflects=true])=>{
      droidAt(index,start,bot);
      yodaAt(start,hero);
      const origin=muzzleOffset.clone().applyAxisAngle(up,faceDroid(bot,hero))
        .add(new Vector3(bot.x,.009,bot.z));
      return {start,hit,index,origin,contact:new Vector3(...target),end:new Vector3(...end),reflects};
    });
    const streaks=[0,1].map(()=>{
      const root=new Group();
      root.name='Бластерный импульс';
      stage.add(root);
      const shell=model(root,'stem',new THREE.MeshBasicMaterial({color:'#ff6c71',transparent:true,opacity:.63,
        toneMapped:false,depthWrite:false,blending:THREE.AdditiveBlending}),[0,0,0],[1,1,1]);
      const inner=model(root,'stem',new THREE.MeshBasicMaterial({color:'#ffe0d2',toneMapped:false}),[0,0,0],[1,1,1]);
      shell.castShadow=inner.castShadow=false;
      const glow=aura(root,'#fe826a',.43);
      glow.scale.set(.21,.15,1);
      return {root,shell,inner,glow};
    });
    const point=new Vector3(), behind=new Vector3(), direction=new Vector3(), center=new Vector3();
    return (t,pulses)=>{
      pulses[0]=pulses[1]=0;
      streaks.forEach(streak=>{streak.root.visible=false;});
      let slot=0;
      for(const {start,hit,index,origin,contact,end,reflects} of events) {
        if(t>=start && t<start+.14) pulses[index]=1-smoothstep(t,start,start+.14);
        if(t<start || t>=hit+.27 || slot===streaks.length) continue;
        if(t<hit) {
          point.copy(origin).lerp(contact,(t-start)/(hit-start));
          direction.copy(contact).sub(origin).normalize();
          behind.copy(point).addScaledVector(direction,-Math.min(.21,point.distanceTo(origin)+.014));
        } else {
          point.copy(contact).lerp(end,(t-hit)/.27);
          direction.copy(end).sub(contact).normalize();
          behind.copy(point).addScaledVector(direction,-.181);
        }
        const {root,shell,inner,glow}=streaks[slot++];
        root.visible=true;
        link(shell,behind,point,.025,.025);
        link(inner,behind,point,.012,.012);
        glow.position.copy(center.copy(behind).lerp(point,.74));
        glow.material.opacity=t<hit?.51:(reflects?.57:.40);
      }
    };
  }

  function effects(stage,aura) {
    const random=Land.rng(45199);
    const flare=aura(stage,'#fff7c9',.87);
    flare.name='Вспышка отражения';
    const pulseLight=new THREE.PointLight('#ebfbbd',0,.70,2);
    stage.add(pulseLight);
    const sparks=Array.from({length:14},(_,i)=>{
      const hint=i%2===0?'#ffe3a4':'#d0fac6';
      const mesh=new Mesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshBasicMaterial({
        color:hint,transparent:true,opacity:0,toneMapped:false,depthWrite:false,blending:THREE.AdditiveBlending
      }));
      stage.add(mesh);
      const angle=random()*Land.tau, speed=.44+random()*.61;
      return {mesh,v:new Vector3(Math.cos(angle)*speed,.20+random()*.95,Math.sin(angle)*speed),size:.008+random()*.011};
    });
    const upDust=Array.from({length:6},(_,i)=>{
      const puff=aura(stage,i%2===0?'#9ab4cc':'#8b9ebc',0,false);
      return {puff,angle:i*2.399,r:.15+random()*.33};
    });
    const hits=[...[2.98,7.14].map(t=>({t,point:new Vector3(...route.find(f=>f.t===t).target)})),
      ...shots.filter(f=>f[5]!==false).map(([,t,,point])=>({t,point:new Vector3(...point)}))]
      .sort((a,b)=>a.t-b.t);
    const puffs=[
      [3.32,.54,.19],[3.47,.70,-.02],[7.48,-.551,.226],[7.59,-.744,-.06],[10.73,.234,.273],
      [13.2,-.24,.25],[15.76,.263,.235]
    ];
    return t=>{
      let hit;
      for(const event of hits) {
        if(event.t>t) break;
        hit=event;
      }
      const age=hit?t-hit.t:Infinity;
      flare.visible=age<.265;
      const pulse=flare.visible?1-smoothstep(age,0,.18):0;
      pulseLight.intensity=pulse*.63;
      if(flare.visible) {
        flare.position.copy(hit.point);
        flare.scale.setScalar(.16+pulse*.37);
        flare.material.opacity=.91*pulse;
        pulseLight.position.copy(hit.point);
      }
      for(const {mesh,v,size} of sparks) {
        mesh.visible=age<.37;
        if(!mesh.visible) continue;
        mesh.position.copy(hit.point).addScaledVector(v,age);
        mesh.position.y-=age*age*.90;
        mesh.material.opacity=(1-age/.37)**1.35;
        mesh.scale.setScalar(size*(1-age*.96));
      }
      let snow;
      for(const event of puffs) {
        if(event[0]>t) break;
        snow=event;
      }
      const drift=snow?t-snow[0]:Infinity;
      for(const {puff,angle,r} of upDust) {
        puff.visible=drift<.76;
        if(!puff.visible) continue;
        const width=.11+.40*drift;
        puff.position.set(snow[1]+Math.cos(angle)*r*drift,.028+drift*r*.47,snow[2]+Math.sin(angle)*r*drift);
        puff.scale.set(width,.038+.14*drift,1);
        puff.material.opacity=.34*(1-smoothstep(drift,.04,.76));
      }
      return pulse;
    };
  }

  function create(stage,rendering) {
    const {link,aura,ground}=rendering;
    scenery(stage,link,ground);
    const master=littleMaster(stage,link);
    const bots=[droid(stage,0,link,aura),droid(stage,1,link,aura)];
    const bolt=energy(stage,link,aura);
    const particles=effects(stage,aura);
    const sword=greenBlade(stage,link,aura);
    const pose=blankPose(), robot={}, pulses=[0,0];
    return function animate(seconds) {
      const t=seconds%cycle;
      yodaAt(t,pose);
      master(t,pose);
      bolt(t,pulses);
      for(const [i,robotPose] of bots.entries()) {
        droidAt(i,t,robot);
        robotPose(t,robot,pose,pulses[i]);
      }
      sword(t,pose,particles(t));
      return true;
    };
  }

  return {create};
})();

;
const FrostWanderers=(()=>{
  const {Group,Vector3,Quaternion,Matrix4}=THREE;
  const {model,batchRepeatedParts}=Scenery;
  const {lerp,smoothstep}=THREE.MathUtils;
  const up=new Vector3(0,1,0);
  const period=53, travelPace=.59, fadeTime=8.2*travelPace;
  const plans=[
    {
      points:[[-.59,.26],[-1.21,.27],[-1.79,.48],[-2.30,.64],[-2.77,.77],[3.05,.75],
        [2.42,.67],[1.90,.48],[1.44,.31],[.77,.20],[.12,.25]],
      times:[[0,0],[3.8,0],[16,.29],[18.5,.29],[33,.63],[35.4,.63],[period,1]],
      steps:96,turn:1
    },
    {
      points:[[-.215,-.09],[.18,-.243],[.91,-.48],[1.84,-.67],[2.42,-.16],[2.98,-.16],
        [-2.72,-.17],[-2.31,-.20],[-1.96,-.23],[-1.57,.15],[-.98,.32]],
      times:[[0,0],[4.4,0],[12.4,.21],[14.1,.21],[31.5,.64],[33.6,.64],[47.3,1],[period,1]],
      steps:78,turn:-1
    }
  ];
  const bronze='#dbac5b', nickel='#bfcddd', navy='#3e5c82', graphite='#273143';
  const panel=new THREE.CylinderGeometry(1,1,1,10);
  const dome=new THREE.SphereGeometry(1,14,6,0,Land.tau,0,Math.PI/2);
  const glow=(color,intensity)=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity});
  const child=(parent,x,y,z)=>{
    const node=new Group();
    node.position.set(x,y,z);
    parent.add(node);
    return node;
  };

  function tall(robot) {
    robot.name='Золотой робот-путник';
    const chest=child(robot,0,.303,0);
    model(chest,'pebble',bronze,[0,.072,0],[.109,.127,.068]);
    model(chest,'round','#615b58',[0,-.025,0],[.074,.034,.053]);
    model(chest,'box','#92704c',[0,.075,.062],[.074,.048,.019]);
    for(let i=0;i<3;i++) model(chest,'box',['#df9c50','#a2ccba','#ead781'][i],[-.021+i*.021,.071,.076],[.010,.026,.007]);
    const head=child(chest,0,.218,0);
    model(head,'pebble','#e5bc72',[0,.020,0],[.074,.097,.065]);
    for(const side of [-1,1]) {
      model(head,'tiny',graphite,[side*.027,.035,.057],[.024,.016,.017]);
      model(head,'tiny',glow('#ffe5a6',.57),[side*.025,.035,.071],[.012,.011,.008]);
    }
    model(head,'box','#735441',[0,-.011,.063],[.039,.009,.009]);
    const limbs=[-1,1].map(side=>{
      const arm=child(chest,side*.096,.126,.003);
      model(arm,'tiny',bronze,[0,0,0],[.039,.036,.036]);
      model(arm,'stem',bronze,[side*.019,-.053,0],[.026,.107,.027],[0,0,side*.18]);
      const elbow=child(arm,side*.023,-.108,0);
      model(elbow,'tiny','#90785d',[0,0,0],[.025,.025,.025]);
      model(elbow,'stem','#d9ac64',[0,-.043,.018],[.024,.096,.024],[-.34,0,0]);
      model(elbow,'pebble',bronze,[0,-.088,.042],[.026,.035,.028]);
      const leg=child(robot,side*.057,.288,0);
      model(leg,'stem',bronze,[0,-.066,0],[.040,.135,.041]);
      const shin=child(leg,0,-.135,0);
      model(shin,'tiny','#9c824e',[0,0,0],[.034,.032,.034]);
      model(shin,'stem','#cca85b',[0,-.054,0],[.031,.113,.033]);
      model(shin,'pebble',bronze,[0,-.120,.034],[.042,.028,.066]);
      return {arm,elbow,leg,shin,side};
    });
    return (t,phase,moving,talk,inspect)=>{
      chest.position.y=.303+.012*(1-Math.cos(2*phase))*moving;
      chest.rotation.set(.09*moving, .085*Math.sin(phase)*moving, .067*Math.sin(phase)*moving);
      head.rotation.y=.17*Math.sin(t*1.8)+inspect*.64*Math.sin(t*2.1)-talk*.22;
      head.rotation.x=inspect*.21+.12*talk*Math.sin(t*7.2);
      for(const {arm,elbow,leg,shin,side} of limbs) {
        const swing=Math.sin(phase+side*Math.PI/2)*moving;
        leg.rotation.x=.46*swing;
        shin.rotation.x=.39*Math.max(0,-swing);
        arm.rotation.x=-.33*swing-talk*(side===1?.77+.34*Math.sin(t*6.1):.16);
        arm.rotation.z=side*(.10+talk*.23+inspect*.18);
        elbow.rotation.x=-.24-talk*.33*(1+Math.sin(t*4.7));
      }
    };
  }

  function rover(robot) {
    robot.name='Купольный робот-путник';
    const body=child(robot,0,0,0);
    model(body,panel,nickel,[0,.205,0],[.145,.293,.145]);
    model(body,panel,navy,[0,.079,0],[.133,.034,.133]);
    for(const x of [-.066,0,.066]) model(body,'box',navy,[x,.215,.138],[.035,.145,.023],[0,x*4,0]);
    for(const y of [.17,.222,.277]) model(body,'box','#91a9c7',[0,y,.158],[.073,.013,.017]);
    const turret=child(body,0,.35,0);
    model(turret,dome,'#aabed5',[0,0,0],[.147,.127,.147]);
    model(turret,panel,navy,[0,0,0],[.145,.036,.146]);
    model(turret,'box',navy,[0,.065,.114],[.070,.063,.031],[-.43,0,0]);
    model(turret,'tiny',graphite,[.008,.069,.135],[.024,.023,.014]);
    const lens=glow('#80e1fe',.57);
    model(turret,'tiny',lens,[.008,.070,.147],[.013,.012,.008]);
    model(turret,'stem','#8a9caf',[-.064,.131,-.042],[.010,.106,.010],[0,0,.17]);
    model(turret,'tiny',glow('#efa3a5',.35),[-.072,.183,-.042],[.015,.015,.015]);
    batchRepeatedParts(turret);
    const feet=[-1,1].map(i=>{
      const foot=child(robot,i*.150,.218,0);
      model(foot,'round',navy,[0,.042,0],[.065,.065,.068]);
      model(foot,'box',nickel,[i*.014,-.041,0],[.067,.180,.088],[0,0,i*.17]);
      model(foot,'pebble','#a9bad0',[i*.025,-.169,.028],[.066,.044,.093]);
      model(foot,'box',graphite,[i*.025,-.198,.030],[.091,.020,.133]);
      return foot;
    });
    return (t,phase,moving,talk,inspect)=>{
      body.rotation.z=.034*Math.sin(phase)*moving+.055*talk*Math.sin(t*5.3);
      body.rotation.x=.13*moving+.04*Math.sin(t*1.8);
      turret.rotation.y=.32*Math.sin(t*2.7)+inspect*.87*Math.sin(t*2.2)+talk*.17*Math.sin(t*9.1);
      lens.emissiveIntensity=.54+.22*Math.sin(t*2)+talk*.66*(.5+.5*Math.sin(t*12.1));
      feet.forEach((foot,i)=>{foot.rotation.x=.11*moving+.055*Math.cos(phase+i*Math.PI)*moving;});
    };
  }

  function navigation(obstacles) {
    const width=104, rows=44;
    const directions=Array.from({length:width*rows},(_,i)=>Land.direction(
      (i%width)/width*Land.tau-Math.PI,((i/width|0)/(rows-1)-.5)*2.78
    ));
    const margins=obstacles.map(({axis,angle})=>({axis,inner:Math.cos(angle+.099),outer:Math.cos(angle+.120)}));
    const clear=(point,edge)=>margins.every(margin=>point.dot(margin.axis)<margin[edge]);
    const available=directions.map(dir=>clear(dir,'outer'));
    const sample=new Vector3();
    function direct(from,to,edge='outer') {
      const steps=Math.max(2,Math.ceil(from.angleTo(to)/.035));
      for(let i=1;i<steps;i++) {
        if(!clear(sample.copy(from).lerp(to,i/steps).normalize(),edge)) return false;
      }
      return true;
    }
    const steps=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
    const neighbors=directions.map((direction,index)=>{
      if(!available[index]) return [];
      const col=index%width, row=index/width|0;
      return steps.map(([dx,dy])=>(row+dy)*width+(col+dx+width)%width)
        .filter(next=>available[next] && direct(direction,directions[next],'inner'));
    });
    const visited=new Set();
    let connected=[];
    for(const [i,walkable] of available.entries()){
      if(!walkable || visited.has(i)) continue;
      const component=[i];
      visited.add(i);
      for(let j=0;j<component.length;j++){
        for(const next of neighbors[component[j]]) {
          if(visited.has(next)) continue;
          visited.add(next);
          component.push(next);
        }
      }
      if(component.length>connected.length) connected=component;
    }
    function nearest(target) {
      let best=-Infinity, chosen;
      for(const i of connected){
        const score=target.dot(directions[i]);
        if(score>best) {
          best=score;
          chosen=i;
        }
      }
      return chosen;
    }
    function around(start,end) {
      if(start===end) return [];
      const from=directions[start], to=directions[end];
      if(direct(from,to)) return [from];
      const open=new Set([start]), previous=new Map(), distance=new Map([[start,0]]);
      while(open.size){
        let current, best=Infinity;
        for(const index of open) {
          const cost=distance.get(index)+directions[index].distanceTo(to);
          if(cost<best) {current=index;best=cost;}
        }
        if(current===end) {
          const route=[end];
          while(route.at(-1)!==start) route.push(previous.get(route.at(-1)));
          const ordered=route.reverse().map(i=>directions[i]);
          const reduced=[];
          let first=0;
          while(first<ordered.length-1){
            reduced.push(ordered[first]);
            let further=ordered.length-1;
            while(further>first+1 && !direct(ordered[first],ordered[further])) further--;
            first=further;
          }
          return reduced;
        }
        open.delete(current);
        const direction=directions[current];
        for(const next of neighbors[current]){
          const cost=distance.get(current)+direction.distanceTo(directions[next]);
          if(cost>=(distance.get(next)??Infinity)) continue;
          distance.set(next,cost);
          previous.set(next,current);
          open.add(next);
        }
      }
      throw new Error('Winter route has no clear path');
    }
    return (points)=>{
      const stops=points.map(([lon,lat])=>nearest(Land.direction(lon,lat)));
      const path=stops.flatMap((start,i)=>around(start,stops[(i+1)%stops.length]));
      const curve=new THREE.CatmullRomCurve3(path,true);
      const checked=curve.getPoints(720);
      if(checked.every(point=>clear(point.normalize(),'inner'))) return curve;
      const rounded=new THREE.CurvePath();
      for(const [i,c] of path.entries()){
        const a=path[(i+path.length-1)%path.length], b=path[(i+1)%path.length];
        const entry=c.clone().lerp(a,.16), exit=c.clone().lerp(b,.16);
        const next=b.clone().lerp(c,.16);
        const corner=new THREE.QuadraticBezierCurve3(entry,c,exit);
        if(corner.getPoints(10).every(point=>clear(point.normalize(),'inner'))) rounded.add(corner);
        else {
          rounded.add(new THREE.LineCurve3(entry,c));
          rounded.add(new THREE.LineCurve3(c,exit));
        }
        rounded.add(new THREE.LineCurve3(exit,next));
      }
      return rounded;
    };
  }

  function makeRoute(plan,waypoints) {
    const curve=waypoints(plan.points);
    curve.arcLengthDivisions=420;
    curve.updateArcLengths();
    const normal=new Vector3(), next=new Vector3(), facing=new Vector3(), right=new Vector3();
    const basis=new Matrix4(), turn=new Quaternion();

    function sample(distance,offset=0) {
      curve.getPointAt(distance%1,normal).normalize();
      curve.getPointAt((distance+.001)%1,next).normalize();
      facing.copy(next).addScaledVector(normal,-next.dot(normal)).normalize();
      if(offset) normal.addScaledVector(right.crossVectors(normal,facing),offset/2.56).normalize();
      return normal;
    }

    function put(target,distance,ground,offset=0,lift=.008,angle=0) {
      sample(distance,offset);
      basis.makeBasis(right.crossVectors(normal,facing).normalize(),normal,facing);
      target.position.copy(normal).multiplyScalar(ground(normal).height+lift);
      target.quaternion.setFromRotationMatrix(basis).multiply(turn.setFromAxisAngle(up,angle));
    }

    function timing(t) {
      const index=plan.times.findIndex(([end],i)=>i>0 && t<=end);
      const [start,a]=plan.times[index-1], [end,b]=plan.times[index];
      const u=(t-start)/(end-start);
      const ramp=.10;
      const progress=u<ramp ? u*u/(2*ramp) : u>1-ramp ? 1-ramp-(1-u)**2/(2*ramp) : u-ramp/2;
      const distance=lerp(a,b,progress/(1-ramp));
      const moving=a===b?0:Math.min(1,u/ramp,(1-u)/ramp);
      const inspect=a===b && a>0 && a<1 ? Math.sin(Math.PI*u)**2 : 0;
      return {distance,moving,inspect};
    }

    const corridor=curve.getSpacedPoints(270).map(point=>point.normalize());
    return {timing,put,corridor};
  }

  function footprints(parent,route,plan,ground,wide) {
    const limit=wide?28:24;
    const geometry=new THREE.PlaneGeometry(1,1);
    const fades=new THREE.InstancedBufferAttribute(new Float32Array(limit),1);
    geometry.setAttribute('printFade',fades);
    const material=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,
      vertexShader:`
        attribute float printFade;
        varying vec2 sole;
        varying float fade;
        void main() {
          sole=uv-.5;
          fade=printFade;
          gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);
        }`,
      fragmentShader:`
        varying vec2 sole;
        varying float fade;
        void main() {
          vec2 edge=max(abs(sole)-vec2(.21,.29),0.);
          float d=length(edge);
          float alpha=(1.-smoothstep(.11,.169,d))*fade;
          vec3 color=mix(vec3(.115,.180,.25),vec3(.44,.58,.68),smoothstep(.07,.151,d));
          float groove=smoothstep(.30,.82,cos(39.*sole.y));
          gl_FragColor=vec4(color,.72*alpha*(.86+.14*groove));
          #include <colorspace_fragment>
        }`
    });
    const mesh=new THREE.InstancedMesh(geometry,material,limit);
    mesh.name=wide?'Следы купольного робота':'Следы золотого робота';
    mesh.count=0;
    mesh.frustumCulled=false;
    mesh.renderOrder=1;
    parent.add(mesh);
    const print=new THREE.Object3D();
    const radial=new Vector3(), sideways=new Vector3(), forward=new Vector3(), surfaceNormal=new Vector3();
    const near=new Vector3(), far=new Vector3(), tilt=new Quaternion();
    const step=.013;
    const grade=(axis)=>{
      near.copy(radial).addScaledVector(axis,-step).normalize();
      far.copy(radial).addScaledVector(axis,step).normalize();
      return (ground(far).height-ground(near).height)/(2*step*2.56);
    };
    const marks=[];
    for(let i=1;i<plan.steps;i++){
      const distance=i/plan.steps;
      let start=0,end=period;
      for(let j=0;j<15;j++) {
        const mid=(start+end)/2;
        if(route.timing(mid).distance<distance) start=mid;
        else end=mid;
      }
      const offsets=wide?[-.17,.17]:[i%2===0?-.057:.057];
      for(const offset of offsets){
        route.put(print,distance,ground,offset,.011);
        radial.copy(print.position).normalize();
        sideways.set(1,0,0).applyQuaternion(print.quaternion);
        forward.set(0,0,1).applyQuaternion(print.quaternion);
        surfaceNormal.copy(radial).addScaledVector(sideways,-grade(sideways))
          .addScaledVector(forward,-grade(forward)).normalize();
        print.quaternion.premultiply(tilt.setFromUnitVectors(radial,surfaceNormal));
        print.rotateX(-Math.PI/2);
        print.scale.set(wide?.112:.079,wide?.102:.13,1);
        print.updateMatrix();
        marks.push({time:(start+end)/2,matrix:print.matrix.clone()});
      }
    }
    return (time,t)=>{
      let count=0;
      for(const mark of marks) {
        let age=t-mark.time;
        if(age<0 && time>=period) age+=period;
        if(age<0 || age>=fadeTime || count>=limit) continue;
        mesh.setMatrixAt(count,mark.matrix);
        fades.setX(count,.94*(1-smoothstep(age,.7*travelPace,fadeTime)));
        count++;
      }
      mesh.count=count;
      mesh.instanceMatrix.needsUpdate=true;
      fades.needsUpdate=true;
    };
  }

  function create(parent,ground,obstacles) {
    const group=new Group();
    group.name='Зимние маршруты двух роботов';
    parent.add(group);
    const waypoints=navigation(obstacles);
    const robots=plans.map((plan,i)=>{
      const root=child(group,0,0,0);
      const pose=i===0?tall(root):rover(root);
      const route=makeRoute(plan,waypoints);
      const trace=footprints(group,route,plan,ground,i===1);
      return {root,route,pose,trace,plan};
    });
    const basis=new Matrix4(), toPeer=new Vector3(), normal=new Vector3(), right=new Vector3(), meeting=new Quaternion();
    const animate=seconds=>{
      const clock=seconds*travelPace;
      const t=clock%period;
      const glance=1-smoothstep(t,2.7,5.5)+smoothstep(t,period-2.8,period);
      for(const {root,route,pose,trace,plan} of robots) {
        const {distance,moving,inspect}=route.timing(t);
        route.put(root,distance,ground,0,.005,plan.turn*.29*inspect);
        pose(seconds,distance*plan.steps*Math.PI,moving,glance,inspect);
        trace(clock,t);
      }
      if(glance<=0) return;
      for(const [i,{root}] of robots.entries()) {
        normal.copy(root.position).normalize();
        toPeer.copy(robots[1-i].root.position).sub(root.position);
        toPeer.addScaledVector(normal,-toPeer.dot(normal)).normalize();
        basis.makeBasis(right.crossVectors(normal,toPeer),normal,toPeer);
        root.quaternion.slerp(meeting.setFromRotationMatrix(basis),glance);
      }
    };
    animate.passesNear=(position,radius)=>{
      normal.copy(position).normalize();
      const margin=Math.cos(radius/2.56);
      return robots.some(({route})=>route.corridor.some(point=>point.dot(normal)>margin));
    };
    return animate;
  }

  return {create};
})();

;
const FrostPenguins=(()=>{
  const {Group,Mesh,Vector3,Vector2,Color}=THREE;
  const {model,batchRepeatedParts}=Scenery;
  const {lerp,smoothstep}=THREE.MathUtils;
  const [lon,lat]=[-.96,-.47];
  const shore=[.045,.365];
  const waterY=-.092;
  const period=32;
  const hut=[-.66,-.47];
  const rack=[.56,.44,-.61];
  const bucket=[.89,.185,-.04];
  const amber=new THREE.MeshStandardMaterial({color:'#ffe6ad',emissive:'#ffc16f',emissiveIntensity:.72});
  const cylinder=new THREE.CylinderGeometry(1,1,1,10);
  const snow='#adc7d2', warmSnow='#c5d9dc', ice='#779bae';
  const boot='#db913f';
  const place=(parent,x=0,y=0,z=0)=>{
    const root=new Group();
    root.position.set(x,y,z);
    parent.add(root);
    return root;
  };

  function edge(angle) {
    return .96+.060*Math.sin(3*angle+.41)+.042*Math.cos(5*angle-.63);
  }

  function holeRatio(x,z) {
    const u=(x-shore[0])/.485, v=(z-shore[1])/.343;
    return Math.hypot(u,v)/edge(Math.atan2(v,u));
  }

  function iceBasin(stage,ground) {
    const site=place(stage,shore[0],0,shore[1]);
    site.name='Прорубь';
    const vertices=[], triangles=[], colors=[];
    const contour=(angle,r,y)=>[
      Math.cos(angle)*.485*r*edge(angle),y,Math.sin(angle)*.343*r*edge(angle)
    ];
    const bank=[[.90,waterY-.049],[1.00,-.042],[1.075,.025],[1.28,.018],[1.42,.006]];
    const shades=['#4e7d96','#719bae','#b2d3df','#88aabf','#9bb7c7'].map(c=>new Color(c));
    const count=18;
    for(let j=0;j<bank.length;j++){
      const [r,y]=bank[j];
      for(let i=0;i<count;i++){
        const angle=i/count*Land.tau;
        const point=contour(angle,r,y+Math.sin(3*angle+j*.6)*.007);
        if(j===bank.length-1) point[1]=ground(point[0]+shore[0],point[2]+shore[1])+.016;
        vertices.push(...point);
        const color=shades[j].clone().multiplyScalar(.94+.078*Math.cos(i*6.2+j));
        colors.push(color.r,color.g,color.b);
        if(j<bank.length-1){
          const a=j*count+i, b=j*count+(i+1)%count;
          triangles.push(a,a+count,b,b,a+count,b+count);
        }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setIndex(triangles);
    geometry.computeVertexNormals();
    const rim=new Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.72}));
    rim.receiveShadow=true;
    site.add(rim);
    const seaVertices=[0,waterY,0], seaColors=[];
    const deep=new Color('#29607c'), shallow=new Color('#489caa');
    seaColors.push(deep.r,deep.g,deep.b);
    const faces=[];
    for(let i=0;i<count;i++){
      seaVertices.push(...contour(i/count*Land.tau,.99,waterY));
      const hue=deep.clone().lerp(shallow,.53+.28*Math.sin(i*2.1));
      seaColors.push(hue.r,hue.g,hue.b);
      faces.push(0,(i+1)%count+1,i+1);
    }
    const floor=new THREE.BufferGeometry();
    floor.setAttribute('position',new THREE.Float32BufferAttribute(seaVertices,3));
    floor.setAttribute('color',new THREE.Float32BufferAttribute(seaColors,3));
    floor.setIndex(faces);
    floor.computeVertexNormals();
    const water=new Mesh(floor,new THREE.MeshStandardMaterial({
      vertexColors:true,roughness:.24,emissive:'#196079',emissiveIntensity:.22
    }));
    water.name='Вода в проруби';
    site.add(water);

    const glints=Array.from({length:6},(_,i)=>{
      const material=new THREE.MeshBasicMaterial({color:i%2===0?'#9ae4ec':'#61acbd',transparent:true,depthWrite:false});
      const glint=model(site,'pebble',material,[-.24+i*.09,waterY+.008,Math.cos(i*6.1)*.13],[.085,.001,.012]);
      glint.castShadow=false;
      return glint;
    });
    return t=>{
      for(const [i,glint] of glints.entries()){
        glint.position.x=-.24+i*.09+.033*Math.sin(t*1.9+i);
        glint.scale.x=.062+.026*Math.sin(t*2.9+i);
        glint.material.opacity=.21+.15*Math.sin(t*1.4+i);
      }
    };
  }

  function igloo(parent,ground) {
    const home=place(parent,hut[0],ground(...hut)-.009,hut[1]);
    home.name='Иглу с теплым окном';
    const shell=place(home);
    const colors=['#a8c1ce','#b8ccd5','#c6d8dc','#a2bdcc','#bfcfd5'];
    const radius=.43, height=.59;
    model(shell,cylinder,ice,[0,-.038,0],[radius*.97,.14,radius*.97]);
    for(const [i,[low,high,blocks]] of [[0,.29,12],[.29,.60,12],[.60,.88,10],[.88,1.14,8],[1.14,1.38,6]].entries()){
      const start=i%2===0?0:Math.PI/blocks;
      for(let j=0;j<blocks;j++){
        const turn=start+j/blocks*Land.tau;
        const width=Land.tau/blocks;
        const shape=new THREE.SphereGeometry(1,3,1,turn+.017,width-.034,Math.PI/2-high,high-low-.015);
        model(shell,shape,colors[(i+j*3)%colors.length],[0,0,0],[radius,height,radius]);
      }
    }
    const core=new THREE.SphereGeometry(1,24,12,0,Land.tau,0,Math.PI/2);
    model(shell,core,'#8ca8b8',[0,0,0],[radius-.012,height-.012,radius-.012]);
    model(shell,new THREE.SphereGeometry(1,10,3,0,Land.tau,0,Math.PI/2-1.367),warmSnow,[0,0,0],[radius,height,radius]);

    const door=[[-.123,0],[-.123,.115],[-.101,.203],[-.047,.246],[.047,.246],[.101,.203],[.123,.115],[.123,0]];
    const outline=door.map(([x,y])=>[x*1.43,y*1.24+.005]);
    const front=.515, back=.315;
    const archPositions=[], indices=[];
    for(const z of [front,back]) for(const shapes of [outline,door]) {
      for(const [x,y] of shapes) archPositions.push(x,y,z);
    }
    const n=door.length;
    for(let i=0;i<n-1;i++){
      indices.push(i,i+1,i+n,i+1,i+n+1,i+n);
      indices.push(i,i+2*n,i+1,i+1,i+2*n,i+2*n+1);
      indices.push(i+n,i+n+1,i+3*n,i+n+1,i+3*n+1,i+3*n);
    }
    const entry=new THREE.BufferGeometry();
    entry.setAttribute('position',new THREE.Float32BufferAttribute(archPositions,3));
    entry.setIndex(indices);
    entry.computeVertexNormals();
    model(shell,entry,new THREE.MeshStandardMaterial({
      color:'#b3cdd8',roughness:.84,side:THREE.DoubleSide,flatShading:true
    }),[0,0,0],[1,1,1]);
    const doorway=new THREE.Shape(door.map(([x,y])=>new Vector2(x,y)));
    model(shell,new THREE.ShapeGeometry(doorway),'#353d50',[0,0,.460],[1,1,1]);
    model(shell,'box','#b59972',[0,.009,.51],[.244,.018,.157]);
    model(shell,'box',amber,[-.098,.115,.468],[.018,.156,.006]);
    model(shell,cylinder,'#7d9eb0',[-.212,.405,.267],[.075,.045,.075],[Math.PI/2-.40,0,.31]);
    model(shell,cylinder,amber,[-.212,.414,.288],[.049,.040,.049],[Math.PI/2-.40,0,.31]);
    const light=new THREE.PointLight('#ffd297',.30,1.3,2);
    light.position.set(-.11,.26,.66);
    home.add(light);
    batchRepeatedParts(shell);
    return light;
  }

  function fish(parent,size) {
    const root=place(parent);
    model(root,'pebble','#78b5c9',[0,0,0],[size*.38,size,size*.27]);
    model(root,'pebble','#bdd7de',[.015*size,0,size*.13],[size*.27,size*.86,size*.18]);
    model(root,'tiny','#223744',[0,-size*.58,size*.27],[size*.095,size*.096,size*.081]);
    for(const side of [-1,1]) {
      model(root,'pebble','#6399ab',[side*size*.24,size*.85,0],[size*.20,size*.58,size*.13],[0,0,-side*.59]);
    }
    return root;
  }

  function equipment(stage,link,ground) {
    const set=place(stage);
    set.name='Веревка и ведро для рыбы';
    const spruce='#6b5956', cord='#aaa492';
    for(const side of [-1,1]){
      const x=rack[0]+side*.35, z=rack[2];
      for(const depth of [-1,1]){
        const start=new Vector3(x+side*.041,0,z+depth*.128);
        start.y=ground(start.x,start.z)-.012;
        const end=new Vector3(x-side*.015,.626,z-depth*.023);
        link(model(set,'stem',spruce,[0,0,0],[1,1,1]),start,end,.034);
        model(set,'pebble',snow,[start.x,start.y+.019,start.z],[.072,.039,.064]);
      }
      model(set,'ring',cord,[x-side*.013,.555,z],[.045,.043,.034],[Math.PI/2,0,0]);
    }
    const sag=x=>.557-.052*(1-(x/.335)**2);
    const line=new THREE.CatmullRomCurve3([-.337,-.20,0,.21,.337].map(x=>new Vector3(rack[0]+x,sag(x),rack[2])));
    model(set,new THREE.TubeGeometry(line,18,.008,5,false),cord,[0,0,0],[1,1,1]);
    const hanging=[-.207,-.029,.123,.205].map((x,i)=>{
      const hook=place(stage,rack[0]+x,sag(x),rack[2]);
      hook.name=i===2?'Свободный крючок':'Рыба на веревке';
      model(hook,'stem',cord,[0,-.032,0],[.006,.066,.006]);
      if(i!==2) fish(hook,.064+i*.008).position.y=-.107;
      return hook;
    });
    const pail=place(set,bucket[0],ground(bucket[0],bucket[2]),bucket[2]);
    pail.name='Ведро с рыбой';
    const profile=[[0,0],[.100,0],[.126,.194],[.116,.196],[.092,.034],[0,.034]];
    model(pail,new THREE.LatheGeometry(profile.map(([x,y])=>new Vector2(x,y)),10),'#768d99',[0,0,0],[1,1,1]);
    for(const y of [.053,.165]) model(pail,'ring','#bfb59f',[0,y,0],[.10+y*.10,.10+y*.10,.042],[Math.PI/2,0,0]);
    const handle=new THREE.TorusGeometry(.113,.007,5,16,Math.PI);
    model(pail,handle,'#494a53',[0,.167,0],[1,1,1],[.32,0,.14]);
    const caught=fish(stage,.076);
    caught.name='Свежий улов на веревке';
    const inPail=fish(stage,.068);
    inPail.name='Свежий улов в ведре';
    const carried=[fish(stage,.076),fish(stage,.068)];
    carried[0].name='Рыба в клюве у первого пингвина';
    carried[1].name='Рыба в клюве у второго пингвина';
    fish(pail,.062).position.set(-.018,.09,.016);
    batchRepeatedParts(set);
    return {hanging,caught,inPail,carried,pail};
  }

  function penguin(stage,name,size,colors) {
    const bird=place(stage);
    bird.name=name;
    bird.scale.setScalar(size);
    const belly=place(bird,0,.175,0);
    model(belly,'pebble',colors[0],[0,.011,0],[.106,.158,.097]);
    model(belly,'pebble',colors[1],[0,.004,.054],[.084,.130,.061]);
    const face=place(belly,0,.142,.018);
    model(face,'pebble',colors[0],[0,0,0],[.077,.080,.075]);
    model(face,'tiny',colors[1],[0,-.022,.048],[.051,.041,.036]);
    const beak=model(face,'pebble','#e3a04e',[0,-.032,.081],[.030,.021,.036],[-.19,0,0]);
    const bill=place(face,0,-.052,.114);
    for(const side of [-1,1]) {
      model(face,'tiny','#fbf6e4',[side*.032,.013,.052],[.024,.025,.017]);
      model(face,'tiny','#202b3c',[side*.032,.013,.067],[.012,.015,.008]);
    }
    const wings=[-1,1].map(side=>{
      const flap=place(belly,side*.084,.068,.006);
      model(flap,'pebble',colors[0],[side*.030,-.052,0],[.033,.091,.033],[.09,0,side*.28]);
      return flap;
    });
    const feet=[-1,1].map(side=>model(bird,'pebble',boot,[side*.042,.022,.038],[.039,.022,.068]));
    return {
      bird,bill,
      pose(t,x,y,z,yaw,pitch,pace,wing,look){
        bird.position.set(x,y,z);
        bird.rotation.set(pitch,yaw,0,'YXZ');
        belly.position.y=.173+.014*Math.abs(Math.sin(t*9.8))*pace;
        belly.rotation.z=.16*pace*Math.sin(t*9.8);
        face.rotation.y=.13*Math.sin(t*2.3)+look*.36*Math.sin(t*4.8);
        face.rotation.x=.08*Math.sin(t*2.5)-look*.14;
        beak.rotation.x=-.11+.10*look*Math.cos(t*6);
        for(let i=0;i<2;i++){
          const swing=Math.sin(t*9.8+i*Math.PI);
          feet[i].position.z=.038+.044*pace*swing;
          feet[i].position.y=.022+.037*pace*Math.max(0,swing);
          wings[i].rotation.x=.14*Math.cos(t*4.5+i)+wing*.72*swing;
          wings[i].rotation.z=(i===0?1:-1)*(.18+wing*.72+.17*pace*swing);
        }
      }
    };
  }

  // Time, position, heading, pitch, stride, flippers, and attention.
  const routes=[
    [[0,-.71,0,.02,1.16,0,.22,.10,.9],[2.3,-.758,0,.27,.52,.03,1,.28,0],
      [4.2,-.595,.01,.36,1.42,.05,.52,.33,.2],[5.5,-.50,.028,.365,1.57,.27,0,.62,.74],
      [6.05,-.275,.155,.365,1.57,.88,0,1,.07],[6.63,-.12,-.49,.365,1.57,1.22,0,1,0],
      [9.15,.32,-.51,.35,1.57,-.65,0,.68,0],[9.83,.417,-.24,.34,1.51,-.79,0,.68,0],
      [10.15,.474,-.09,.342,1.51,-.58,0,1,.18],[10.82,.565,.021,.348,1.56,-.27,.28,.68,.12],
      [12.15,.675,0,.285,2.78,-.03,.80,.10,.16],[14.1,.635,0,-.18,Math.PI,.03,.90,.26,0],
      [15.6,.69,0,-.47,Math.PI,.03,.58,.25,.42],[16.7,.684,.082,-.50,Math.PI,-.20,0,.55,.51],
      [17.4,.684,.070,-.497,Math.PI,-.13,0,.40,.31],[18.2,.68,0,-.476,-2.23,0,.26,.35,.13],
      [20.5,.32,0,-.30,-1.35,.04,.88,.26,0],[23.6,-.16,0,-.365,-1.89,.03,.81,.28,0],
      [25.6,-.472,0,-.13,-.92,.04,.72,.26,.38],[28,-.71,0,.02,1.16,0,.41,.17,.75],[period,-.71,0,.02,1.16,0,.22,.10,.9]],
    [[0,.274,0,-.175,-.74,0,.18,.16,.75],[2.1,.18,0,-.24,-.29,.03,.67,.38,.59],
      [4.3,.12,.005,-.139,.15,.08,.74,.30,0],[5.45,.108,.022,-.052,.14,.26,0,.64,.54],
      [6.04,.105,.139,.124,.13,.99,0,1,.12],[6.59,.106,-.48,.235,.12,1.14,0,1,0],
      [9.23,.155,-.51,.557,.22,-.59,0,.57,0],[9.83,.180,-.24,.624,.29,-.73,0,.70,0],
      [10.2,.182,-.095,.662,.30,-.62,0,1,.10],[10.86,.229,.022,.753,.35,-.32,.21,.74,0],
      [12.25,.50,0,.794,1.32,.04,.95,.23,.28],[14.19,.772,0,.56,2.80,.03,.92,.25,0],
      [15.44,.845,0,.20,2.99,.06,.80,.31,.35],[16.5,.887,.009,.106,Math.PI,.58,0,.54,.32],
      [17.33,.895,.003,.131,2.97,.30,0,.44,.34],[18.2,.80,0,.18,-1.26,0,.29,.30,.45],
      [20.45,.621,0,-.145,-2.34,.03,.83,.32,0],[23.6,.37,0,-.293,-1.75,.03,.74,.26,.26],
      [26,.245,0,-.20,-.74,.02,.48,.20,.63],[period,.274,0,-.175,-.74,0,.18,.16,.75]],
    [[0,-.33,0,-.13,.89,.08,0,.36,.53],[4,-.32,0,-.143,1.36,.03,.20,.55,.70],
      [7,-.13,0,-.194,1.58,.03,.78,.56,.61],[9,-.038,0,-.129,.64,.11,.25,.42,.88],
      [13,-.045,0,-.129,.21,.25,0,.22,1],[16,-.22,.063,-.172,-1.14,-.19,.76,.92,.08],
      [17.8,-.32,0,-.247,-2.13,.10,.84,.50,.12],[21,-.36,0,-.176,.22,.05,.38,.35,.52],
      [25,-.33,0,-.13,.89,.08,.22,.76,.78],[period,-.33,0,-.13,.89,.08,0,.36,.53]]
  ];

  function poseAlong(actor,route,t,ground) {
    const end=route.findIndex(([time],i)=>i>0 && t<=time);
    const previous=route[end-1], next=route[end];
    const raw=(t-previous[0])/(next[0]-previous[0]);
    const blend=lerp(raw,smoothstep(raw,0,1),.74);
    const [x,y,z,yaw,pitch,pace,wing,look]=previous.slice(1).map((a,i)=>{
      const delta=next[i+1]-a;
      return a+(i===3?Math.atan2(Math.sin(delta),Math.cos(delta)):delta)*blend;
    });
    const shoreBlend=smoothstep(holeRatio(x,z),1.10,1.32);
    actor.pose(t,x,y+shoreBlend*ground(x,z),z,yaw,pitch,pace,wing,look);
  }

  const splashEvents=[
    [[6.26,-.239,.365,1],[10.15,.405,.342,.65]],
    [[6.28,.105,.172,1],[10.17,.179,.608,.68]]
  ];
  function spray(stage,index){
    const rings=Array.from({length:3},()=>{
      const material=new THREE.MeshBasicMaterial({color:'#a6d8e0',transparent:true,depthWrite:false,side:THREE.DoubleSide});
      const ring=model(stage,new THREE.RingGeometry(.83,1,21),material,[0,0,0],[1,1,1],[-Math.PI/2,0,0]);
      ring.castShadow=false;
      return ring;
    });
    const random=Land.rng(765+index);
    const drops=Array.from({length:9},(_,i)=>{
      const drop=model(stage,'tiny','#97bfce',[0,0,0],[.017,.024,.014]);
      drop.castShadow=false;
      return {drop,angle:i*2.39996,v:.17+random()*.20,up:.52+random()*.43};
    });
    return t=>{
      const [first,second]=splashEvents[index];
      const [start,x,z,power]=t>=second[0]?second:first;
      const age=t-start;
      for(const [i,ring] of rings.entries()){
        const elapsed=age-i*.13;
        ring.visible=elapsed>=0 && elapsed<.93;
        if(!ring.visible) continue;
        ring.position.set(lerp(x,shore[0],elapsed*.22),waterY+.007+i*.001,lerp(z,shore[1],elapsed*.22));
        ring.scale.setScalar((.046+elapsed*.23)*power);
        ring.material.opacity=.66*(1-elapsed/.93)**1.4;
      }
      for(const {drop,angle,v,up} of drops){
        const h=age*up-1.43*age*age;
        drop.visible=age>=0 && h>0;
        if(!drop.visible) continue;
        drop.position.set(x+Math.cos(angle)*v*age,waterY+h*power,z+Math.sin(angle)*v*age);
        drop.scale.setScalar(.013*(1.3-age));
      }
    };
  }

  function create(stage,{link,ground}) {
    stage.name='Рыбацкая стоянка пингвинов';
    const homeLight=igloo(stage,ground);
    const water=iceBasin(stage,ground);
    const {hanging,caught,inPail,carried,pail}=equipment(stage,link,ground);
    const plants=place(stage);
    for(const [i,[x,z,kind]] of [[-1.09,-.31,'berry'],[-.71,.69,'grass'],[.77,.78,'ice'],[.95,-.61,'grass'],
      [1.03,.33,'berry'],[-.95,-.74,'ice'],[-.34,-.66,'grass']].entries()){
      const patch=place(plants,x,ground(x,z),z);
      FrostVegetation.undergrowth(patch,kind,625+i*736,link);
    }
    batchRepeatedParts(plants);
    const adults=[
      penguin(stage,'Пингвин у веревки',1.10,['#27364b','#d9e0dc']),
      penguin(stage,'Пингвин с ведром',1.00,['#354358','#e0e5d8'])
    ];
    const chick=penguin(stage,'Пингвиненок',.70,['#65748b','#d6dbd8']);
    const splashes=adults.map((_,i)=>spray(stage,i));
    const beak=new Vector3(), hook=new Vector3();
    const fresh=[caught,inPail];
    const offset=[0,14];
    const backgroundLight=new THREE.PointLight('#afd9fc',.38,2.4,2);
    backgroundLight.position.set(.45,1.35,.69);
    stage.add(backgroundLight);

    return (seconds,visible)=>{
      homeLight.visible=backgroundLight.visible=visible;
      if(!visible) return;
      water(seconds);
      for(const [i,hanger] of hanging.entries()) hanger.rotation.set(.07*Math.cos(seconds*2+i),0,.15*Math.sin(seconds*2.1+i*.64));
      for(const [i,actor] of adults.entries()){
        const clock=seconds+offset[i], t=clock%period;
        poseAlong(actor,routes[i],t,ground);
        splashes[i](t);
        const hasFish=(Math.floor(clock/period)+i)%3!==2;
        const delivery=smoothstep(t,16.37,17.12);
        const holding=hasFish && t>=9.84 && delivery<1;
        const fish=fresh[i];
        fish.visible=clock>=17.12 && !(holding && delivery>.87);
        if(i===0){
          hook.set(0,-.107,0);
          stage.worldToLocal(hanging[2].localToWorld(hook));
          fish.rotation.set(hanging[2].rotation.x,0,hanging[2].rotation.z);
        } else {
          hook.set(bucket[0]+.012,bucket[1]-.039+pail.position.y,bucket[2]+.013);
          fish.rotation.set(.62,.22,.82);
        }
        fish.position.copy(hook);
        const catchInBeak=carried[i];
        catchInBeak.visible=holding;
        if(holding){
          stage.worldToLocal(actor.bill.getWorldPosition(beak));
          catchInBeak.position.copy(beak).lerp(hook,delivery);
          catchInBeak.rotation.set(
            lerp(1.24,fish.rotation.x,delivery),lerp(0,fish.rotation.y,delivery),lerp(.30,fish.rotation.z,delivery)
          );
        }
      }
      poseAlong(chick,routes[2],(seconds+2.10)%period,ground);
    };
  }

  return {create,holeRatio,lon,lat};
})();

;
const FrostFlight=(()=>{
  const {Group,Vector3,Quaternion,Matrix4,Color}=THREE;
  const {model,batchRepeatedParts}=Scenery;
  const {smoothstep,lerp,euclideanModulo}=THREE.MathUtils;
  const period=36;
  const white='#c1c9cf', coral='#bf625c', graphite='#394657', steel='#748398', yellow='#d9aa64';
  const engine=new THREE.CylinderGeometry(1,1,1,10);
  const nose=new THREE.CylinderGeometry(.27,1,1,6);
  const glow=(color,intensity)=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity});
  const lens=glow('#79c7e2',.40);
  const navRed=glow('#ffb092',.94), navGreen=glow('#a9e1db',.89);
  const up=new Vector3(0,0,1);
  const axis=new Vector3(), reference=new Vector3(), next=new Vector3();
  const across=new Vector3(), upright=new Vector3(), basis=new Matrix4();

  function cylinder(root,color,x,y,z,r,length,shape=engine) {
    return model(root,shape,color,[x,y,z],[r,length,r],[Math.PI/2,0,0]);
  }

  function group(parent,x=0,y=0,z=0) {
    const node=new Group();
    node.position.set(x,y,z);
    parent.add(node);
    return node;
  }

  function corvette(root) {
    const hull=group(root);
    model(hull,'box',white,[0,0,-.025],[.16,.133,.28]);
    cylinder(hull,white,0,0,.216,.091,.333,nose);
    model(hull,'box',coral,[0,.044,.184],[.044,.018,.264],[-.14,0,0]);
    model(hull,'pebble',graphite,[0,.091,.047],[.064,.056,.115],[-.12,0,0]);
    model(hull,'pebble',lens,[.001,.112,.060],[.055,.030,.084],[-.14,0,0]);
    model(hull,'tiny','#dce0dc',[0,.092,-.107],[.035,.032,.034]);
    model(hull,'tiny','#567e9d',[0,.103,-.099],[.037,.013,.020]);
    for(const side of [-1,1]) for(const wing of [-1,1]) {
      const assembly=group(hull,side*.058,wing*.026,-.085);
      assembly.rotation.set(0,side*.21,side*wing*.27);
      model(assembly,'box',white,[side*.134,0,0],[.278,.028,.178]);
      model(assembly,'box',coral,[side*.153,wing*.015,-.018],[.087,.007,.146]);
      model(assembly,'box',steel,[side*.223,0,-.058],[.079,.023,.031]);
      cylinder(assembly,graphite,side*.265,0,.081,.018,.292);
      cylinder(assembly,yellow,side*.265,0,.15,.023,.033);
      cylinder(assembly,white,side*.066,wing*.022,-.059,.046,.182);
      cylinder(assembly,steel,side*.066,wing*.022,-.153,.038,.033);
      model(assembly,'tiny',side===1?navGreen:navRed,[side*.271,0,-.071],[.021,.016,.018]);
    }
    batchRepeatedParts(hull);
    return [[-.124,-.049,-.270],[-.124,.049,-.270],[.124,-.049,-.270],[.124,.049,-.270]];
  }

  const contour=[[-.192,-.117],[-.078,-.182],[.078,-.182],[.192,-.117],[.192,.117],[.078,.182],[-.078,.182],[-.192,.117]];
  function panelGeometry() {
    const panel=new THREE.Shape(contour.map(([y,z])=>new THREE.Vector2(z,y)));
    return new THREE.ExtrudeGeometry(panel,{depth:.014,bevelEnabled:false});
  }
  const plate=panelGeometry();
  function interceptor(root,link,index) {
    const hull=group(root);
    const trim=index===0?'#9babb9':'#afb1bd';
    model(hull,'pebble',trim,[0,0,0],[.128,.125,.141]);
    cylinder(hull,graphite,0,0,.108,.093,.062);
    cylinder(hull,lens,0,0,.138,.069,.007);
    for(let i=0;i<6;i++){
      const angle=i*Math.PI/3;
      model(hull,'box',trim,[.041*Math.sin(angle),.041*Math.cos(angle),.148],[.007,.078,.009],[0,0,-angle]);
    }
    for(const side of [-1,1]) {
      model(hull,'box',steel,[side*.142,0,0],[.135,.070,.064]);
      model(hull,plate,index===0?'#272f43':'#34394b',[side*.208,0,0],[1,1,1],[0,Math.PI/2,0]);
      const x=side*.213;
      for(const [i,[y,z]] of contour.entries()) {
        const [ny,nz]=contour[(i+1)%contour.length];
        link(model(hull,'stem',trim,[0,0,0],[1,1,1]),new Vector3(x,y,z),new Vector3(x,ny,nz),.018);
        if(i%2===0) link(model(hull,'stem',trim,[0,0,0],[1,1,1]),new Vector3(x,0,0),new Vector3(x,y,z),.014);
      }
      model(hull,'tiny',navRed,[side*.057,-.048,.113],[.024,.014,.021]);
      model(hull,'tiny',index===0?navRed:navGreen,[side*.222,0,.119],[.022,.016,.018]);
    }
    cylinder(hull,graphite,0,0,-.109,.066,.057);
    batchRepeatedParts(hull);
    return [[-.039,0,-.145],[.039,0,-.145]];
  }

  function flightLine(index,seconds,out) {
    const a=seconds/period*Land.tau;
    const lag=index===1?.38:index===2?.72:0;
    const u=a-lag+(index===1?.10*Math.sin(2*a+.25):index===2?.10*Math.sin(2*a-1.2):0);
    const yaw=u+.091*Math.sin(2*u+.58)+.036*Math.sin(5*u);
    const wave=.27*Math.sin(u+.77)+.27*Math.sin(2*u-.96)+.095*Math.sin(4*u+.38);
    const flank=index===1 ? .14+.16*Math.sin(a*2+.72) : index===2 ? -.22-.17*Math.cos(a*2-.11) : .075*Math.sin(3*u);
    const range=4.06+.28*(.5+.5*Math.sin(3*u+.30))+
      (index===1?.12+.065*Math.cos(a*2):index===2?.26+.09*Math.sin(a*2):.055*Math.sin(a*4));
    const latitude=wave+flank, planar=Math.cos(latitude)*range;
    return out.set(Math.sin(yaw)*planar,Math.sin(latitude)*range,Math.cos(yaw)*planar);
  }

  function orientation(index,seconds,position,rotation){
    flightLine(index,seconds,position);
    flightLine(index,seconds+.065,next);
    axis.copy(next).sub(position).normalize();
    reference.copy(position).normalize();
    across.crossVectors(reference,axis).normalize();
    upright.crossVectors(axis,across).normalize();
    rotation.setFromRotationMatrix(basis.makeBasis(across,upright,axis));
    const t=euclideanModulo(seconds,period);
    const kick=index===0?[8.20,9.65,22.10,23.65]:index===1?[11.40,13.3,28.3,30.1]:[14.55,16.38,31.16,33.26];
    const roll=(smoothstep(t,kick[0],kick[1])-smoothstep(t,kick[2],kick[3]))*Land.tau;
    const turn=.31*Math.sin(t/period*Land.tau*3+index)+.17*Math.sin(t/period*Land.tau*6);
    rotation.multiply(new Quaternion().setFromAxisAngle(up,turn+roll*(index===1?-1:1)));
  }

  function wake(parent,index,end,aura) {
    const detail=group(parent,...end);
    const color=index===0?'#feb1a9':'#f59580';
    const light=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.76,depthWrite:false,toneMapped:false});
    const flash=cylinder(detail,light,0,0,-.045,index===0?.023:.019,.105,nose);
    flash.rotation.x=-Math.PI/2;
    const halo=aura(detail,color,.72);
    halo.position.z=-.052;
    halo.scale.setScalar(.133);
    return t=>{
      const flutter=.5+.5*Math.sin(t*45+end[0]*22);
      flash.scale.y=.073+.037*flutter;
      halo.material.opacity=.47+.25*flutter;
    };
  }

  function flightTrail(parent,index) {
    const count=20;
    const points=new Float32Array(count*2*3);
    const fade=new Float32Array(count*2);
    const geometry=new THREE.BufferGeometry();
    const cells=[];
    for(let i=0;i<count;i++){
      const fraction=i/(count-1);
      fade[i*2]=fade[i*2+1]=(1-fraction)**1.6;
      if(i<count-1) cells.push(i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2);
    }
    const position=new THREE.BufferAttribute(points,3);
    geometry.setAttribute('position',position);
    geometry.setAttribute('trailFade',new THREE.BufferAttribute(fade,1));
    geometry.setIndex(cells);
    const material=new THREE.ShaderMaterial({
      uniforms:{hue:{value:new Color(index===0?'#eeb9a7':index===1?'#a5b9dc':'#e5a7a7')}},
      vertexShader:`attribute float trailFade; varying float age; void main() {
        age=trailFade; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
      fragmentShader:`uniform vec3 hue; varying float age; void main() {
        gl_FragColor=vec4(hue,age*.33);
        #include <colorspace_fragment>
      }`,
      side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending
    });
    const ribbon=new THREE.Mesh(geometry,material);
    ribbon.frustumCulled=false;
    parent.add(ribbon);
    const point=new Vector3(), edge=new Vector3();
    return (t,viewer)=>{
      for(let i=0;i<count;i++){
        const f=i/(count-1);
        flightLine(index,t-.22-f*(index===0?1.45:1.14),point);
        flightLine(index,t-.16-f*(index===0?1.45:1.14),edge);
        edge.sub(point).cross(viewer??point).normalize().multiplyScalar(lerp(.042,.007,f));
        position.setXYZ(i*2,point.x-edge.x,point.y-edge.y,point.z-edge.z);
        position.setXYZ(i*2+1,point.x+edge.x,point.y+edge.y,point.z+edge.z);
      }
      position.needsUpdate=true;
    };
  }

  const volleys=[
    [2.4,1,+1],[4.8,2,-1],[8.56,1,+1],[9.5,2,-1],[12.3,1,-1],
    [15.9,2,+1],[19.2,1,-1],[22.4,2,+1],[25.7,1,-1],[29.2,2,+1],[32.7,1,+1],[34.4,2,-1]
  ];
  function bursts(parent,link,aura){
    const spread=.43;
    const pose=new Quaternion();
    const midpoint=new Vector3(), forward=new Vector3(), radial=new Vector3();
    const signals=volleys.flatMap(([seconds,from,side])=>[0,.14].map(delay=>{
      const time=seconds+delay;
      const origin=new Vector3();
      orientation(from,time,origin,pose);
      origin.add(new Vector3(side*.055,-.05,.13).applyQuaternion(pose));
      flightLine(0,time+spread,midpoint);
      flightLine(0,time+spread+.07,forward);
      radial.copy(midpoint).normalize();
      forward.sub(midpoint).normalize();
      const goal=midpoint.clone().addScaledVector(radial,side*(.59+delay*.40)).addScaledVector(forward,.045);
      const heading=goal.clone().sub(origin);
      const length=heading.length();
      const ray=heading.normalize();
      return {time,origin,ray,length};
    }));
    const temp=new Vector3(), tail=new Vector3();
    const effects=Array.from({length:4},()=>{
      const root=group(parent);
      root.name='Световой импульс погони';
      const core=model(root,'stem',new THREE.MeshBasicMaterial({color:'#e5ffcb',toneMapped:false}),[0,0,0],[1,1,1]);
      const bloom=aura(root,'#a9f3b2',.66);
      bloom.scale.setScalar(.128);
      core.castShadow=false;
      return {root,core,bloom};
    });
    return seconds=>{
      let i=0;
      for(const {time,origin,ray,length} of signals) {
        const age=euclideanModulo(seconds-time,period);
        if(age>.71 || i>=effects.length) continue;
        const {root,core,bloom}=effects[i++];
        temp.copy(origin).addScaledVector(ray,length*age/spread);
        tail.copy(temp).addScaledVector(ray,-Math.min(.22,.02+age*length));
        root.visible=true;
        link(core,tail,temp,.013);
        bloom.position.copy(temp);
        bloom.material.opacity=.64*(1-smoothstep(age,.45,.71));
        core.visible=age<.65;
      }
      for(;i<effects.length;i++) effects[i].root.visible=false;
    };
  }

  function create(parent,{link,aura}) {
    const chase=group(parent);
    chase.name='Погоня вокруг Ледяной рощи';
    chase.visible=false;
    const vehicles=[
      'Светлый корабль с красными крыльями','Перехватчик с верхней орбиты','Перехватчик с нижней орбиты'
    ].map((name,i)=>{
      const craft=group(chase);
      craft.name=name;
      const ports=i===0?corvette(craft):interceptor(craft,link,i-1);
      const animatePorts=ports.map(port=>wake(craft,i,port,aura));
      const trail=flightTrail(chase,i);
      return {craft,animatePorts,trail};
    });
    const fire=bursts(chase,link,aura);
    return (seconds,viewer,visible)=>{
      chase.visible=visible;
      if(!visible) return;
      const t=euclideanModulo(seconds,period);
      for(const [i,{craft,animatePorts,trail}] of vehicles.entries()) {
        orientation(i,t,craft.position,craft.quaternion);
        animatePorts.forEach(animate=>animate(t));
        trail(t,viewer);
      }
      fire(t);
    };
  }

  return {create};
})();

;
const DuelWorld=(()=>{
  const {Color,Group,Mesh,Vector3}=THREE;
  const {clamp,lerp,smoothstep}=THREE.MathUtils;
  const {model,batchRepeatedParts}=Scenery;
  const up=new Vector3(0,1,0);
  const bladeLength=.72;
  const cycle=14.8;
  const linkDelta=new Vector3();
  let auraTexture;

  function glowTexture() {
    if(auraTexture) return auraTexture;
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=64;
    const context=canvas.getContext('2d');
    const gradient=context.createRadialGradient(32,32,0,32,32,32);
    for(const [offset,alpha] of [[0,.98],[.15,.72],[.35,.36],[.62,.10],[1,0]]) {
      gradient.addColorStop(offset,`rgba(255,255,255,${alpha})`);
    }
    context.fillStyle=gradient;
    context.fillRect(0,0,64,64);
    auraTexture=new THREE.CanvasTexture(canvas);
    return auraTexture;
  }

  function aura(parent,color,opacity,additive=true) {
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({
      color,map:glowTexture(),opacity,depthWrite:false,transparent:true,toneMapped:false,
      blending:additive?THREE.AdditiveBlending:THREE.NormalBlending
    }));
    parent.add(sprite);
    return sprite;
  }

  function link(mesh,start,end,width,depth=width) {
    linkDelta.copy(end).sub(start);
    const length=linkDelta.length();
    if(length<.0001) return;
    mesh.position.copy(start).addScaledVector(linkDelta,.5);
    mesh.quaternion.setFromUnitVectors(up,linkDelta.multiplyScalar(1/length));
    mesh.scale.set(width,length,depth);
  }

  function landscape(group) {
    const random=Land.rng(19907);
    const radius=2.56;
    function site(lon,lat,height,profile) {
      const axis=Land.direction(lon,lat), rotation=Land.frame(lon,lat).rotation;
      const east=new Vector3(1,0,0).applyQuaternion(rotation);
      const south=new Vector3(0,0,1).applyQuaternion(rotation);
      const anchor=axis.clone().multiplyScalar(height);
      return {axis,rotation,east,south,anchor,height,profile};
    }
    function glade(x,z) {
      const edge=Math.hypot((x+.09*Math.sin(z*2.6))/.99,(z+.04+.07*x)/.60);
      const bank=.105*Math.exp(-((z+.82+.21*x)**2*12+(x+.30)**2*.9));
      const curve=-.22*(x*x+z*z)+bank;
      return [curve*smoothstep(edge,.98,1.74),1-smoothstep(edge,1.07,2.48)];
    }
    function hollow(x,z) {
      const edge=Math.hypot((x-.13*Math.sin(z*2.2))/.97,(z-.045-.09*x)/.61);
      const ridge=.17*Math.exp(-((z+.79-.31*x)**2*9+(x-.32)**2*.7));
      const curve=-.23*(x*x+z*z)+ridge;
      return [curve*smoothstep(edge,1.01,1.68),1-smoothstep(edge,1.06,2.38)];
    }
    function shore(x,z) {
      const edge=Math.hypot((x+.10*Math.sin(z*2.6))/1.24,(z+.09*x)/1.11);
      const hole=FrostPenguins.holeRatio(x,z);
      const grade=-.17*(x*x+z*z)+.076*Math.sin(x*2.8+.30)*Math.cos(z*2.3);
      const depth=.30*(1-smoothstep(hole,.90,1.22));
      return [grade*smoothstep(hole,1.26,1.61)-depth,1-smoothstep(edge,1.02,1.65)];
    }
    const frontSite=site(0,.99,radius-.075,glade);
    const rearSite=site(Math.PI,-.99,radius-.064,hollow);
    const campSite=site(FrostPenguins.lon,FrostPenguins.lat,radius-.048,shore);
    const valleySite=site(FrostValley.lon,FrostValley.lat,radius+.005);
    const sites=[frontSite,rearSite,campSite];
    const clearing=frontSite.axis, campAxis=campSite.axis;
    const night=new Color('#647e97'), fresh=new Color('#b9cdd4'), drift=new Color('#8ba6bb');
    const poolBed=new Color('#416b83');
    const bank=Land.direction(2.49,-.34);
    function ground(normal) {
      const {x,y,z}=normal;
      const ripple=Math.sin(x*10+z*5)*Math.cos(y*8+z*6)*.048;
      const mound=Math.sin(8*y-6*x+2*z)*.068+Math.cos(z*7-y*4)*.032;
      const pillows=Math.sin(x*28+z*12)*Math.cos(z*20-y*16)*.023;
      let height=radius+.027+ripple+mound+pillows;
      const dust=.45+.21*Math.sin(5*x+3*z)*Math.cos(4*y-2*z);
      const color=night.clone().lerp(drift,clamp(dust+ripple*3.1,0,1)).lerp(fresh,.31+.20*dust);
      color.lerp(fresh,.25*Math.exp((normal.dot(bank)-1)*11));
      height+=FrostVegetation.relief(normal,color);
      const valleyAlignment=normal.dot(valleySite.axis);
      if(valleyAlignment>.74) {
        const project=valleySite.height/valleyAlignment;
        const terrain=FrostValley.shape(normal.dot(valleySite.east)*project,normal.dot(valleySite.south)*project);
        height+=terrain.raise;
        FrostValley.tintSurface(color,terrain);
      }
      for(const zone of sites) {
        const alignment=normal.dot(zone.axis);
        if(alignment<.72) continue;
        const project=zone.height/alignment;
        const [level,blend]=zone.profile(normal.dot(zone.east)*project,normal.dot(zone.south)*project);
        height=lerp(height,(zone.height+level)/alignment,blend);
        if(zone===campSite) color.lerp(poolBed,blend*(1-smoothstep(level,-.20,-.065))*.38);
      }
      return {height,color};
    }

    function surfaceOf(zone) {
      const point=new Vector3(), radial=new Vector3(), normal=zone.axis;
      return (x,z)=>{
        let y=0;
        for(let i=0;i<3;i++) {
          point.copy(zone.anchor).addScaledVector(zone.east,x).addScaledVector(zone.south,z).addScaledVector(normal,y);
          radial.copy(point).normalize();
          y+=(ground(radial).height-point.length())/radial.dot(normal);
        }
        return y;
      };
    }

    function groupAt(zone,parent) {
      const root=new Group();
      root.position.copy(zone.anchor);
      root.quaternion.copy(zone.rotation);
      parent.add(root);
      return root;
    }
    const geometry=Land.globeGeometry(176,90,(lon,lat)=>{
      const normal=Land.direction(lon,lat);
      const {height,color}=ground(normal);
      return {position:normal.multiplyScalar(height),color};
    });
    const planet=new Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.91}));
    planet.receiveShadow=true;
    planet.castShadow=true;
    group.add(planet);
    const forest=new Group();
    group.add(forest);

    function onGround(parent,lon,lat,offset=0,yaw=0) {
      const frame=Land.frame(lon,lat);
      const normal=Land.direction(lon,lat);
      const site=new Group();
      site.position.copy(normal).multiplyScalar(ground(normal).height+offset);
      site.quaternion.copy(frame.rotation);
      site.rotateY(yaw);
      parent.add(site);
      return site;
    }

    const kinds=['spruce','fir','birch','pine','snag'];
    const loose=[], obstacles=[
      {axis:campAxis,angle:.60},
      {axis:clearing,angle:.56},
      {axis:rearSite.axis,angle:.55}
    ];
    function avoid(root,radius) {
      obstacles.push({axis:root.position.clone().normalize(),angle:radius/2.56});
    }
    function pass(lon,lat) {
      return ((lon<-1.66 || lon>2.35) && Math.abs(lat+.16)<.34) ||
        (lon>-1.51 && lon<-.41 && Math.abs(lat-.25)<.18);
    }
    function fir(lon,lat,size,kind,seed) {
      const root=onGround(forest,lon,lat,.006,random()*Land.tau);
      FrostVegetation.tree(root,kind,size,seed,link);
      avoid(root,size*(kind==='pine'?.31:kind==='spruce'?.24:.13));
    }

    for(const [i,[lon,lat,size]] of [
      [-1.07,1.03,1.17,true],[1.05,1.14,1.29,true],[-1.79,1.20,1.0,true],[1.93,1.11,.99,true],
      [-2.41,.95,.82,false],[2.56,.80,.95,true],[3.05,1.08,.77,true],
      [-.83,.79,.90,false],[.94,.76,1.05,false],[-1.28,.52,.74,true],[1.3,.57,.62,false],
      [-.70,.41,.64,false],[.75,.35,.72,false],
      [-1.94,-.45,.75,false],[2.37,-.48,.98,true],[-2.61,-.52,.87,false],
      [.19,-.69,.92,true],[-.85,-.92,.74,false],[1.42,-.91,.93,false],
      [2.96,.06,.82,true],[-2.89,.06,.87,false],[-1.35,-.14,.65,false],
      [1.36,-.17,.70,true],[2.18,.27,.79,false],[-2.06,.27,.76,false],[-.36,-1.23,.59,false],
      [-1.53,-.17,.74,false],[-1.16,.05,.76,true],[-.79,.025,.63,false],[-.48,-.11,.64,false],
      [.53,-.58,.63],[.87,-.62,.52],[1.63,-.75,.65],[2.52,-.86,.60],[-2.40,.52,.72],[-2.68,.34,.48],
      [-.26,.67,.49],[1.14,-.47,.74],[2.52,.54,.77],[-.32,-.79,.63],[-1.28,-.95,.48]
    ].entries()) {
      const normal=Land.direction(lon,lat);
      const kind=kinds[(i*7+Math.floor(i/3))%kinds.length];
      if(!pass(lon,lat) && normal.dot(clearing)>-.870 && normal.dot(campAxis)<.866 &&
        normal.dot(clearing)<.91 && normal.dot(valleySite.axis)<.895)
        fir(lon,lat,size,kind,1197+i*3211);
    }

    for(let i=0;i<86;i++) {
      const lon=i*2.399963%Land.tau;
      const lat=Math.asin((i+.5)/43-1);
      const normal=Land.direction(lon,lat);
      if(Math.abs(normal.dot(clearing))>.842 || normal.dot(campAxis)>.902 || normal.dot(valleySite.axis)>.917 ||
        pass(Math.atan2(normal.x,normal.z),lat)) continue;
      const patch=onGround(forest,lon,lat,0,random()*Land.tau);
      const size=.047+random()*.16;
      if(size>.147) avoid(patch,size*.90);
      else loose.push({patch,size});
      const rock=['#526a82','#71889b','#617689'][i%3];
      model(patch,'pebble',rock,[0,.018,0],[size,.44*size,.78*size],[.12,i*.43,.17]);
      model(patch,'pebble','#acbec5',[.011,.021+.33*size,.013],[.72*size,.16*size,.73*size],[.15,0,-.07]);
      if(i%2===0) {
        const winterPlant=onGround(forest,lon+.052,lat-.022,.002,random()*Land.tau);
        FrostVegetation.undergrowth(winterPlant,['grass','berry','ice'][i%3],2200+i*765,link);
        loose.push({patch:winterPlant,size:.10});
      }
    }

    const ruins=onGround(forest,2.76,.30,.02,.22);
    ruins.name='Замерзшие руины';
    avoid(ruins,.43);
    for(const side of [-1,1]) for(let i=0;i<4;i++) {
      const x=side*(.275-.035*i);
      model(ruins,'pebble','#546e83',[x,.10+i*.115,.01],[.133,.09,.113],[.2,i*.41,side*.38]);
      if(i===3) model(ruins,'pebble','#a1bec8',[x,.195+i*.115,.01],[.110,.039,.108],[.16,0,side*.18]);
    }
    model(ruins,'pebble','#8098a8',[0,.535,-.008],[.18,.08,.12],[.2,.6,-.11]);

    const stage=groupAt(frontSite,group);
    const frontSurface=surfaceOf(frontSite);
    stage.name='Заснеженная поляна';
    const rim=new Group();
    stage.add(rim);
    for(const [i,[x,z,width]] of [[-1.01,-.38,.17],[.96,-.37,.19],[-.87,.40,.13],[.82,.47,.11],
      [-.64,-.63,.13],[.40,-.59,.16],[-.99,-.24,.125],[.87,-.53,.14]].entries()) {
      model(rim,'pebble','#657b90',[x,.025,z],[width,width*.42,width*.79],[.2,i*.74,.13]);
      model(rim,'pebble','#9eb3c0',[x,.062,z],[width*.84,width*.23,width*.75],[.16,i*.73,.14]);
    }
    for(const [i,[x,z,kind,size]] of [
      [-1.03,-.54,'spruce',1.04],[-.76,-.73,'birch',1.35],[-.39,-.92,'pine',.69],
      [.09,-1.05,'fir',1.27],[.69,-.88,'birch',1.14],[1.04,-.65,'snag',.75]
    ].entries()){
      const tree=new Group();
      tree.position.set(x,-.02,z);
      tree.rotation.y=i*.54;
      rim.add(tree);
      FrostVegetation.tree(tree,kind,size,4301+i*758,link);
    }
    for(const [i,[x,z,kind]] of [[-.88,.53,'grass'],[.96,.49,'berry'],[-.82,-.67,'ice'],[.78,-.72,'grass']].entries()){
      const patch=new Group();
      patch.position.set(x,0,z);
      rim.add(patch);
      FrostVegetation.undergrowth(patch,kind,690+i*813,link);
    }
    for(const mesh of rim.children) mesh.position.y+=frontSurface(mesh.position.x,mesh.position.z);
    batchRepeatedParts(rim);

    const rear=groupAt(rearSite,group);
    rear.name='Поляна Йоды на обратной стороне';
    const camp=groupAt(campSite,group);
    const valley=groupAt(valleySite,group);
    const snowman=onGround(group,1.65,-.54,.008,-.24);
    avoid(snowman,.30);
    return {stage,rear,camp,campAxis,clearing,ground,snowman,obstacles,forest,loose,valley,
      valleyAxis:valleySite.axis,valleySurface:surfaceOf(valleySite),rearSurface:surfaceOf(rearSite),campSurface:surfaceOf(campSite)};
  }

  function snowFigure(root) {
    root.name='Снеговик между елями';
    const middle=new Group(), head=new Group(), hat=new Group(), scarf=new Group();
    middle.position.y=.22;
    head.position.y=.215;
    hat.position.y=.090;
    scarf.position.set(.107,.146,.055);
    root.add(middle);
    middle.add(head,scarf);
    head.add(hat);
    const snow='#c4d9dd', shade='#9fb9c9', coal='#30394c', knit='#a64c53';
    model(root,'pebble',shade,[0,.024,0],[.252,.039,.214]);
    model(root,'pebble',snow,[0,.117,0],[.178,.131,.158],[.07,.28,0]);
    model(middle,'pebble',snow,[0,.063,0],[.127,.115,.117],[.11,.18,.08]);
    model(head,'pebble',snow,[0,.022,0],[.098,.095,.096],[0,.26,.08]);
    model(middle,'round',knit,[0,.152,.009],[.094,.019,.094]);
    model(scarf,'box',knit,[.005,-.042,.012],[.038,.110,.016],[.15,0,-.37]);
    for(let i=0;i<3;i++){
      model(scarf,'stem','#c26d69',[-.014+i*.013,-.100,.015],[.005,.023,.006],[.13,0,.08]);
    }
    for(const [x,y,z,size] of [[-.034,.039,.105,.018],[.036,.035,.104,.018],[0,-.019,.097,.011],
      [-.018,-.013,.094,.008],[.019,-.014,.095,.008],[0,.126,.105,.013],[0,.070,.119,.015],[0,.015,.110,.014]]) {
      model(y>=.070 || y===.015?middle:head,'tiny',coal,[x,y,z],[size,size,size]);
    }
    const carrot=new THREE.ConeGeometry(1,1,7);
    model(head,carrot,'#df9860',[.007,.010,.132],[.023,.106,.022],[Math.PI/2+.12,-.14,0]);
    const brim=new THREE.CylinderGeometry(1,1,1,11);
    model(hat,brim,coal,[0,.012,0],[.125,.026,.122]);
    model(hat,brim,'#384458',[0,.068,0],[.077,.111,.076],[0,0,.05]);
    model(hat,brim,knit,[0,.033,0],[.079,.021,.079]);
    const arms=[-1,1].map(side=>{
      const limb=new Group();
      limb.position.set(side*.102,.082,0);
      middle.add(limb);
      const elbow=new Vector3(side*.095,-.031,.015);
      const tip=new Vector3(side*.172,.054,.026);
      const twig=(start,end,width)=>link(model(limb,'stem','#796561',[0,0,0],[1,1,1]),start,end,width);
      twig(new Vector3(),elbow,.014);
      twig(elbow,tip,.012);
      twig(tip,tip.clone().add(new Vector3(side*.02,.049,-.017)),.008);
      twig(tip,tip.clone().add(new Vector3(side*.042,.022,.015)),.007);
      return limb;
    });
    return t=>{
      const beat=t%13.8;
      const trick=smoothstep(beat,7.8,8.41)-smoothstep(beat,8.76,9.3);
      middle.rotation.z=.094*Math.sin(t*1.35)+.095*trick;
      head.rotation.set(.04+.065*Math.sin(t*1.93),.26*Math.sin(t*.83),-.09*Math.sin(t*1.35)-.17*trick);
      hat.position.y=.09+.135*trick;
      hat.rotation.z=-.12+.46*trick+.069*Math.sin(t*1.35);
      scarf.rotation.x=.24*Math.sin(t*2.1)-.35*trick;
      arms[0].rotation.z=.105*Math.sin(t*2.9)-.51*trick;
      arms[1].rotation.z=.10*Math.sin(t*2.6)+.41*trick;
    };
  }

  // Each contact cue shares one point in the clearing, so both glowing blades visibly meet.
  const key=(t,left,right,touch=null)=>({t,left,right,touch});
  const stance=(x,z,grip,aim,lift=0,bend=0,turn=0)=>({x,z,grip,aim,lift,bend,turn});
  const openLeft=stance(-.735,.075,[-.61,.386,.17],[-.25,.97,.18]);
  const openRight=stance(.747,-.055,[.58,.393,.05],[.28,.95,.23]);
  const score=[
    key(0,openLeft,openRight),key(.57,openLeft,openRight),
    key(1.13,stance(-.635,.061,[-.55,.49,.15],[-.13,.95,.22],0,.03,-.25),
      stance(.61,-.04,[.51,.44,.13],[.1,.88,.20],0,.018,.22)),
    key(1.55,stance(-.478,.06,[-.242,.49,.09],[.8,.2,0],0,.043),
      stance(.475,-.042,[.249,.47,.01],[-.7,.27,.1],0,.037),[.012,.751,.047]),
    key(1.78,stance(-.449,.05,[-.205,.49,.086],[.8,.2,0],0,.04),
      stance(.475,-.065,[.261,.46,.015],[-.7,.27,.1],0,.055),[.052,.706,.056]),
    key(2.37,stance(-.682,.11,[-.578,.39,.17],[-.69,.47,.47]),
      stance(.669,-.120,[.538,.42,.037],[.72,.62,.05])),
    key(2.9,stance(-.549,.137,[-.463,.56,.22],[-.67,.75,.21],0,.034,-.28),
      stance(.574,-.051,[.455,.266,.051],[-.43,.59,.24],0,.116,.31)),
    key(3.23,stance(-.409,.125,[-.173,.309,.140],[.77,-.18,.11],0,.087),
      stance(.439,-.067,[.226,.353,.065],[-.6,.16,.1],0,.082),[.009,.281,.127]),
    key(3.6,stance(-.502,.142,[-.321,.387,.22],[.69,.39,.27],0,.028,.13),
      stance(.658,-.145,[.557,.302,.018],[-.12,-.34,.84],0,.096,.17)),
    key(4.17,stance(-.606,.02,[-.546,.50,.145],[-.17,.91,.20],0,0,-.15),
      stance(.633,-.124,[.517,.52,-.004],[.73,.78,.13],0,0,.36)),
    key(4.54,stance(-.466,.011,[-.26,.49,.061],[.66,.42,.15],0,.03),
      stance(.417,-.064,[.202,.537,.052],[-.77,.18,-.01],0,.014),[-.011,.896,.039]),
    key(5.06,stance(-.68,-.063,[-.526,.35,.103],[-.36,.08,.87],0,.097,-.41),
      stance(.587,-.043,[.417,.445,.046],[.37,.81,.25],0,.041,.31)),
    key(5.7,stance(-.619,-.220,[-.491,.385,-.125],[-.36,.52,.51],0,.039,.32),
      stance(.61,.119,[.452,.399,.243],[.39,.68,.27],0,.025,-.47)),
    key(6.18,stance(-.482,-.159,[-.317,.48,-.087],[.51,.61,.3],0,.046,.06),
      stance(.555,.159,[.471,.363,.199],[-.25,.67,.41],0,.083,-.03)),
    key(6.55,stance(-.399,-.113,[-.206,.56,-.081],[.61,.63,.11],0,.011,.18),
      stance(.303,.131,[.141,.704,.147],[-.65,.46,-.09],.304,.015,.30),[.016,.968,.016]),
    key(6.88,stance(-.468,-.132,[-.332,.467,-.028],[-.24,.78,-.42],0,.049,-.27),
      stance(.46,.153,[.368,.659,.191],[.31,.51,.73],.236,.059,-.32)),
    key(7.25,stance(-.628,-.109,[-.531,.362,.018],[-.31,.43,.53],0,.035),
      stance(.658,.147,[.481,.343,.253],[.61,.3,.41],0,.095,.19)),
    key(7.8,stance(-.691,-.056,[-.555,.397,.063],[-.3,.85,.13]),
      stance(.687,.123,[.518,.402,.226],[.24,.97,.1])),
    key(8.25,stance(-.691,-.056,[-.555,.397,.063],[-.3,.85,.13]),
      stance(.687,.123,[.518,.402,.226],[.24,.97,.1])),
    key(8.73,stance(-.604,-.069,[-.442,.48,.071],[-.14,.86,.30],0,.023,-.28),
      stance(.554,.098,[.464,.41,.177],[.42,.71,.35],0,.046,.37)),
    key(9.18,stance(-.410,-.046,[-.171,.512,.021],[.7,.4,0],0,.065),
      stance(.483,.064,[.245,.478,.082],[-.65,.44,0],0,.052),[.081,.756,.069]),
    key(9.59,stance(-.361,-.027,[-.137,.475,.055],[.7,.4,0],0,.083,.15),
      stance(.449,.080,[.230,.469,.10],[-.65,.44,0],0,.086,-.09),[.082,.703,.102]),
    key(10.11,stance(-.396,-.042,[-.159,.475,.067],[.7,.4,0],0,.071),
      stance(.418,.035,[.181,.467,.073],[-.65,.44,0],0,.066),[.025,.676,.105]),
    key(10.46,stance(-.498,.004,[-.438,.501,.118],[-.41,.87,.2],0,.038,-.36),
      stance(.535,-.035,[.432,.451,.082],[.42,.82,.19],0,.038,.34)),
    key(10.96,stance(-.447,.074,[-.222,.347,.158],[.8,.3,.14],0,.083),
      stance(.478,-.079,[.256,.417,.012],[-.8,.3,.18],0,.054),[-.015,.389,.212]),
    key(11.19,stance(-.537,.104,[-.391,.361,.226],[.80,.31,.28],0,.055),
      stance(.543,-.083,[.402,.406,.036],[.09,.92,.13],0,.039,.14)),
    key(11.78,stance(-.673,.105,[-.526,.39,.194],[-.64,.59,.2]),
      stance(.652,-.074,[.498,.376,.031],[.65,.65,.18])),
    key(12.58,openLeft,openRight),key(cycle,openLeft,openRight)
  ];

  function poseSample() {
    return {x:0,z:0,lift:0,bend:0,turn:0,walk:0,grip:new Vector3(),aim:new Vector3()};
  }

  const beginDirection=new Vector3(), endDirection=new Vector3(), blendedTouch=new Vector3();

  function directionFor(cue,side,out) {
    const pose=cue[side];
    if(!cue.touch) return out.fromArray(pose.aim).normalize();
    return out.fromArray(cue.touch).sub(blendedTouch.fromArray(pose.grip)).normalize();
  }

  function sample(seconds,side,out) {
    const t=THREE.MathUtils.euclideanModulo(seconds,cycle);
    let i=1;
    while(i<score.length-1 && t>score[i].t) i++;
    const before=score[i-1], after=score[i], a=before[side], b=after[side];
    const span=after.t-before.t;
    const raw=clamp((t-before.t)/span,0,1);
    const weight=lerp(raw,smoothstep(raw,0,1),.68);
    out.x=lerp(a.x,b.x,weight);
    out.z=lerp(a.z,b.z,weight);
    out.lift=lerp(a.lift,b.lift,weight);
    out.bend=lerp(a.bend,b.bend,weight);
    out.turn=lerp(a.turn,b.turn,weight);
    out.walk=Math.min(1,Math.hypot(b.x-a.x,b.z-a.z)/span*2.15)*Math.sin(Math.PI*raw)**.55;
    out.grip.fromArray(a.grip).lerp(blendedTouch.fromArray(b.grip),weight);
    if(before.touch && after.touch) {
      out.aim.fromArray(before.touch).lerp(blendedTouch.fromArray(after.touch),weight).sub(out.grip).normalize();
    } else {
      out.aim.copy(directionFor(before,side,beginDirection)).lerp(directionFor(after,side,endDirection),weight).normalize();
    }
  }

  function capeGeometry() {
    const geometry=new THREE.BufferGeometry();
    const vertices=new Float32Array(7*9*3), indices=[];
    for(let row=0;row<8;row++) for(let column=0;column<6;column++) {
      const first=row*7+column;
      indices.push(first,first+1,first+7,first+1,first+8,first+7);
    }
    geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
    geometry.setIndex(indices);
    return geometry;
  }

  const robe=new THREE.LatheGeometry([[0,0],[.175,0],[.155,.08],[.120,.17],[.106,.26],[.107,.30],[0,.32]]
    .map(([x,y])=>new THREE.Vector2(x,y)),14);

  function fighter(stage,name,dark) {
    const figure=new Group();
    figure.name=name;
    stage.add(figure);
    const chest=new Group();
    figure.add(chest);
    const costume=dark
      ?{robe:'#592b40',over:'#52293c',edge:'#bc6770',pants:'#3d3249',boot:'#30283a',skin:'#bb8e8b',metal:'#8a7783'}
      :{robe:'#39687c',over:'#3f556c',edge:'#86babb',pants:'#334b65',boot:'#344451',skin:'#e1bfa3',metal:'#83a1a9'};
    model(chest,robe,costume.robe,[0,.199,0],[1,1,.83]);
    model(chest,'round',costume.over,[0,.408,-.012],[.116,.116,.091]);
    model(chest,'round',costume.edge,[0,.491,.013],[.086,.035,.080],[.11,0,.095]);
    model(chest,'round',costume.pants,[0,.319,.004],[.131,.027,.091]);
    model(chest,'box',costume.metal,[.029,.316,.095],[.055,.033,.023]);
    for(const side of [-1,1]) {
      model(chest,'box',costume.edge,[side*.066,.409,.073],[.030,.135,.030],[.18,0,side*.34]);
    }

    const head=new Group();
    head.position.set(0,.558,.012);
    chest.add(head);
    if(dark) {
      model(head,'round','#54374e',[0,.033,-.034],[.133,.146,.119],[.13,0,.026]);
      model(head,'round','#332b40',[0,.019,.061],[.104,.107,.078]);
      model(head,'round',costume.skin,[0,.002,.091],[.076,.077,.048]);
      model(head,'round',costume.over,[0,-.059,.096],[.097,.035,.052]);
      model(head,'pebble','#69435a',[-.038,.117,.016],[.092,.047,.088],[.41,0,-.23]);
    } else {
      model(head,'round',costume.skin,[0,.015,.008],[.102,.108,.091]);
      model(head,'round','#aaaca9',[.002,.072,-.048],[.109,.069,.081],[.26,0,-.13]);
      model(head,'pebble','#edd1b2',[-.038,.091,.054],[.089,.042,.064],[.22,.29,-.25]);
      model(head,'pebble','#d5baa8',[.039,.085,-.036],[.103,.059,.072],[.3,.24,.32]);
      model(head,'round','#577683',[0,-.062,.062],[.095,.035,.050]);
    }
    for(const side of [-1,1]) {
      model(head,'tiny','#363649',[side*.033,.028,dark?.129:.09],[.011,.012,.008]);
      if(!dark) model(head,'tiny',costume.skin,[side*.096,.009,0],[.019,.025,.025]);
    }

    const cloakGeometry=capeGeometry();
    const cloak=new Mesh(cloakGeometry,new THREE.MeshStandardMaterial({
      color:dark?'#512d48':'#426b81',roughness:1,side:THREE.DoubleSide
    }));
    cloak.castShadow=true;
    cloak.receiveShadow=true;
    cloak.frustumCulled=false;
    figure.add(cloak);
    const segments=['stem','stem'];
    function limb(isArm) {
      return segments.map((shape,i)=>model(figure,shape,isArm?(i===0?costume.robe:costume.over):costume.pants,
        [0,0,0],[1,1,1]));
    }
    const mainArm=limb(true), spareArm=limb(true);
    const sleeves=[model(figure,'round',costume.edge,[0,0,0],[.043,.035,.041]),
      model(figure,'round',costume.edge,[0,0,0],[.04,.033,.038])];
    const hands=sleeves.map(()=>model(figure,'round',costume.skin,[0,0,0],[.039,.037,.042]));
    const legs=[limb(false),limb(false)];
    const boots=legs.map(()=>model(figure,'round',costume.boot,[0,0,0],[.045,.043,.074]));
    const localHand=new Vector3(), freeHand=new Vector3(), elbow=new Vector3(), bendVector=new Vector3();
    const shoulder=new Vector3(), elbowDirection=new Vector3(), knee=new Vector3(), hip=new Vector3(), ankle=new Vector3();
    const handPoint=new Vector3();

    function arm(parts,index,dst,body,side) {
      shoulder.set(side*.104,.458-body.bend,-.013);
      elbowDirection.copy(dst).sub(shoulder);
      const length=elbowDirection.length();
      if(length<.001) elbowDirection.set(0,-1,0);
      else elbowDirection.multiplyScalar(1/length);
      bendVector.set(side*.78,-.68,.16).projectOnPlane(elbowDirection).normalize();
      const fold=Math.sqrt(Math.max(.0064,.166**2-(length*.5)**2));
      elbow.copy(shoulder).lerp(dst,.50).addScaledVector(bendVector,fold);
      link(parts[0],shoulder,elbow,.046,.043);
      link(parts[1],elbow,dst,.040,.039);
      hands[index].position.copy(dst);
      sleeves[index].position.copy(dst).lerp(elbow,.19);
    }

    function update(now,body,other) {
      const yaw=Math.atan2(other.x-body.x,(other.z-body.z)*1.02)
        +(dark?-.44:.43)+body.turn;
      figure.position.set(body.x,.009+body.lift,body.z);
      figure.rotation.y=yaw;
      chest.position.y=-body.bend;
      chest.rotation.x=body.bend*2.2+.049*body.walk;
      chest.rotation.z=body.turn*.20;
      head.rotation.y=(dark?.22:-.20)+body.turn*-.55;
      head.rotation.x=-.055+body.bend*.69;
      localHand.copy(body.grip).sub(figure.position).applyAxisAngle(up,-yaw);
      freeHand.set(-.165-.038*body.walk,.305+body.bend*.35+.059*Math.sin(now*4.4),.088-body.turn*.18);
      arm(mainArm,0,localHand,body,1);
      arm(spareArm,1,freeHand,body,-1);

      for(const [index,parts] of legs.entries()) {
        const side=index===0?-1:1;
        const step=Math.sin(now*10.5+index*Math.PI);
        const rise=Math.max(0,Math.cos(now*10.5+index*Math.PI))*body.walk*.064;
        const flight=smoothstep(body.lift,0,.27);
        const stride=.076+step*body.walk*.104;
        hip.set(side*.066,.279-body.bend,0);
        ankle.set(side*(.087+body.bend*.35),.042+rise+flight*(index===0?.098:.038),
          stride*side+.02+flight*(index===0?.116:-.087));
        knee.copy(hip).lerp(ankle,.50);
        knee.z+=.039+body.bend*.81+flight*.052;
        link(parts[0],hip,knee,.047,.046);
        link(parts[1],knee,ankle,.041,.038);
        boots[index].position.copy(handPoint.set(0,-.005,.016).add(ankle));
        boots[index].rotation.x=-.22*flight+.11*step*body.walk;
      }

      const cloth=cloakGeometry.getAttribute('position');
      for(let row=0;row<9;row++) for(let column=0;column<7;column++) {
        const t=row/8, u=(column-3)/3;
        const roll=Math.sin(now*5.5-t*6.2+u*2.4);
        const x=u*(.103+.092*t)+body.turn*t*t*.16+roll*t*.019;
        const y=.481-t*(dark?.427:.384)-body.bend+t*t*(.13*body.walk+.18*body.lift)+u*u*t*.025;
        const z=-.065-.09*t-.24*t*t*(body.walk+body.lift)+roll*.035*t;
        cloth.setXYZ(row*7+column,x,y,z);
      }
      cloth.needsUpdate=true;
      cloakGeometry.computeVertexNormals();
    }

    return {update};
  }

  const vertexTrail=`
    attribute float strength;
    varying float lineStrength;
    void main(){
      lineStrength=strength;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    }
  `;
  const fragTrail=`
    uniform vec3 tint;
    uniform float opacity;
    varying float lineStrength;
    void main(){ gl_FragColor=vec4(tint,opacity*lineStrength); }
  `;

  function sword(stage,name,cold) {
    const holder=new Group();
    holder.name=name;
    stage.add(holder);
    const neon=cold?'#80e1ff':'#ff5c86', white=cold?'#e2faff':'#fff0f3';
    const wrap=model(holder,'stem',cold?'#47617a':'#5a4858',[0,0,0],[1,1,1]);
    const collar=model(holder,'stem','#8b9fa6',[0,0,0],[1,1,1]);
    const sleeve=model(holder,'stem',new THREE.MeshBasicMaterial({
      color:neon,toneMapped:false,transparent:true,opacity:.47,depthWrite:false,blending:THREE.AdditiveBlending
    }),[0,0,0],[1,1,1]);
    const core=model(holder,'stem',new THREE.MeshBasicMaterial({color:white,toneMapped:false}),[0,0,0],[1,1,1]);
    core.name='Световое лезвие';
    sleeve.castShadow=core.castShadow=false;
    const glows=Array.from({length:7},()=>aura(holder,neon,.56));
    const light=new THREE.PointLight(neon,0,1.02,2);
    holder.add(light);
    const g=new THREE.BufferGeometry(), rows=9, columns=3, indices=[], strength=[];
    const positions=new THREE.BufferAttribute(new Float32Array(rows*columns*3),3);
    for(let i=0;i<rows;i++) for(let j=0;j<columns;j++) {
      strength.push((1-i/(rows-1))**1.5*[0,.33,1][j]);
      if(i===rows-1 || j===columns-1) continue;
      const a=i*columns+j;
      indices.push(a,a+1,a+columns,a+1,a+columns+1,a+columns);
    }
    g.setAttribute('position',positions);
    g.setAttribute('strength',new THREE.Float32BufferAttribute(strength,1));
    g.setIndex(indices);
    const trailMat=new THREE.ShaderMaterial({
      uniforms:{tint:{value:new Color(neon)},opacity:{value:0}},vertexShader:vertexTrail,fragmentShader:fragTrail,
      transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false
    });
    const trail=new Mesh(g,trailMat);
    trail.frustumCulled=false;
    holder.add(trail);
    const hiltStart=new Vector3(),bladeStart=new Vector3(),cap=new Vector3(),tip=new Vector3(),part=new Vector3();
    const history=poseSample(), previousTip=new Vector3();

    function update(now,pose,side,flash) {
      hiltStart.copy(pose.grip).addScaledVector(pose.aim,-.108);
      bladeStart.copy(pose.grip).addScaledVector(pose.aim,.066);
      cap.copy(pose.grip).addScaledVector(pose.aim,.080);
      tip.copy(pose.grip).addScaledVector(pose.aim,bladeLength);
      link(wrap,hiltStart,bladeStart,.037,.037);
      link(collar,part.copy(bladeStart).addScaledVector(pose.aim,-.036),cap,.046,.046);
      link(sleeve,cap,tip,.019,.019);
      link(core,cap,tip,.012,.012);
      for(const [i,glow] of glows.entries()) {
        const rate=(i+.5)/glows.length;
        glow.position.copy(cap).lerp(tip,rate);
        glow.scale.setScalar(.124+.022*Math.sin(now*14+i)+flash*.043);
        glow.material.opacity=.45+flash*.19;
      }
      light.position.copy(pose.grip).lerp(tip,.37);
      light.position.y=lerp(.28,light.position.y,.21);
      light.position.z+=.047;
      light.intensity=.36+.067*Math.sin(now*13)+flash*.24;
      sample(now-.19,side,history);
      previousTip.copy(history.grip).addScaledVector(history.aim,bladeLength);
      const velocity=smoothstep(previousTip.distanceTo(tip),.058,.34);
      trail.visible=velocity>.015;
      if(trail.visible) {
        trailMat.uniforms.opacity.value=velocity*.68;
        for(let i=0;i<rows;i++) {
          const t=i/(rows-1);
          sample(now-t*.184,side,history);
          for(let j=0;j<columns;j++) {
            part.copy(history.grip).addScaledVector(history.aim,[.23,.52,bladeLength][j]);
            positions.setXYZ(i*columns+j,part.x,part.y,part.z);
          }
        }
        positions.needsUpdate=true;
      }
    }

    return {update};
  }

  function weather(stage) {
    const random=Land.rng(19998), flakes=[];
    const position=new THREE.BufferAttribute(new Float32Array(162*3),3);
    const color=new THREE.BufferAttribute(new Float32Array(162*3),3);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',position);
    geometry.setAttribute('color',color);
    const dull=new Color('#789ab4'), pale=new Color('#e1eef7');
    for(let i=0;i<162;i++) {
      flakes.push({x:(random()-.5)*4.05,y:random()*2.3,z:(random()-.52)*2.65,speed:.12+random()*.27,phase:random()*Land.tau});
      const tint=dull.clone().lerp(pale,.18+random()*.76);
      color.setXYZ(i,tint.r,tint.g,tint.b);
    }
    const snow=new THREE.Points(geometry,new THREE.PointsMaterial({
      map:glowTexture(),size:.030,transparent:true,opacity:.72,depthWrite:false,vertexColors:true
    }));
    snow.name='Снег на поляне';
    snow.frustumCulled=false;
    stage.add(snow);
    const haze=Array.from({length:6},(_,i)=>{
      const puff=aura(stage,i%2===0?'#62758e':'#496080',.16,false);
      puff.scale.set(1.72+i%3*.25,.43+i%2*.15,1);
      return puff;
    });
    return seconds=>{
      for(const [i,flake] of flakes.entries()) {
        const drift=Math.sin(seconds*.89+flake.phase);
        const height=THREE.MathUtils.euclideanModulo(flake.y-seconds*flake.speed,2.21);
        const x=THREE.MathUtils.euclideanModulo(flake.x+seconds*.093+drift*.18+2.05,4.10)-2.05;
        position.setXYZ(i,x,.032+height,flake.z+.11*Math.sin(seconds*.68+flake.phase));
      }
      position.needsUpdate=true;
      for(const [i,puff] of haze.entries()) {
        const wind=seconds*.48+i*1.85;
        puff.position.set((i-2.5)*.49+.32*Math.sin(wind),.14+i%2*.21,-.57-(i%3)*.211);
        puff.material.opacity=.12+.05*Math.sin(wind*.72);
      }
    };
  }

  function clashes(stage) {
    const seeds=Land.rng(170293);
    const clashes=score.filter(cue=>cue.touch && ![1.78,9.59].includes(cue.t));
    const flare=aura(stage,'#ffd5dd',0);
    flare.name='Вспышка при встрече клинков';
    const accent=new THREE.PointLight('#f6e4e8',0,.96,2);
    stage.add(accent);
    const sparkGeo=new THREE.IcosahedronGeometry(1,0);
    const sparks=Array.from({length:17},(_,i)=>{
      const color=i%3===0?'#bcecff':i%3===1?'#fff0cb':'#ffb6b9';
      const particle=new Mesh(sparkGeo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}));
      stage.add(particle);
      const angle=seeds()*Land.tau, force=.21+seeds()*1.18;
      return {
        particle,
        velocity:new Vector3(Math.cos(angle)*force,.20+seeds()*1.24,Math.sin(angle)*force),
        size:.008+seeds()*.019
      };
    });
    const strike=new Vector3();
    return time=>{
      let age=Infinity, hit;
      for(const cue of clashes) {
        if(cue.t>time) break;
        age=time-cue.t;
        hit=cue;
      }
      const visible=age<.40;
      flare.visible=visible;
      const pulse=visible?(1-smoothstep(age,0,.18)):0;
      accent.intensity=pulse*1.63;
      if(visible) {
        strike.fromArray(hit.touch);
        flare.position.copy(strike);
        accent.position.copy(strike);
        flare.scale.setScalar(.18+.48*pulse);
        flare.material.opacity=pulse*.92;
      }
      for(const {particle,velocity,size} of sparks) {
        particle.visible=visible;
        if(!visible) continue;
        particle.position.copy(strike).addScaledVector(velocity,age);
        particle.position.y-=age*age*.85;
        particle.scale.setScalar(size*(1-.88*age/.4));
        particle.material.opacity=(1-age/.4)**1.32;
      }
      return pulse;
    };
  }

  function stageView(stage,elevation) {
    const heading=new Vector3(0,elevation,1).applyQuaternion(stage.quaternion).normalize();
    const vertical=up.clone().applyQuaternion(stage.quaternion);
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(heading,new Vector3(),vertical)
    );
  }

  function arenaView(stage,x,y,z,elevation,distance) {
    const center=new Vector3(x,y,z).applyQuaternion(stage.quaternion).add(stage.position);
    return {center,rotation:stageView(stage,elevation),distance};
  }

  function create() {
    const group=new Group();
    const {stage,rear,camp,campAxis,clearing,ground,snowman,obstacles,forest,loose,valley,
      valleyAxis,valleySurface,rearSurface,campSurface}=landscape(group);
    group.userData.arenas={
      duel:arenaView(stage,.014,.50,-.055,.37,3.8),
      yoda:arenaView(rear,0,.47,.02,.51,3.94),
      penguins:arenaView(camp,.03,.19,.06,.81,3.36),
      valley:arenaView(valley,.015,.15,.00,1.17,4.9)
    };
    group.userData.coverView=stageView(stage,.82);
    group.userData.front=clearing;
    const warm=fighter(stage,'Джедай с алым клинком',true);
    const cold=fighter(stage,'Джедай с голубым клинком',false);
    const red=sword(stage,'Алый световой меч',false), blue=sword(stage,'Голубой световой меч',true);
    const snow=weather(stage), rearSnow=weather(rear), flare=clashes(stage);
    const left=poseSample(), right=poseSample();
    const animateEncounter=FrostEncounter.create(rear,{link,aura,ground:rearSurface});
    const visitPenguins=FrostPenguins.create(camp,{link,ground:campSurface});
    const roam=FrostWanderers.create(group,ground,obstacles);
    const orbit=new Group();
    orbit.userData.excludeFromCoverFit=true;
    group.add(orbit);
    const chase=FrostFlight.create(orbit,{link,aura});
    const snowmanAxis=snowman.position.clone().normalize();
    const probe=new Vector3();
    const visitValley=FrostValley.create(valley,{link,aura,ground:valleySurface,occupied:(x,z,size)=>{
      probe.set(x,valleySurface(x,z),z).applyQuaternion(valley.quaternion).add(valley.position);
      const nextToFigure=probe.clone().normalize().dot(snowmanAxis)>Math.cos((size+.46)/2.56);
      return nextToFigure || roam.passesNear(probe,.187+size);
    }});
    const groves=new Group();
    groves.name='Дальние зимние рощи';
    forest.add(groves);
    FrostVegetation.fillForest(groves,{
      link,
      clear:(normal,size)=>normal.dot(valleyAxis)<.901 && !roam.passesNear(normal,.209+size) &&
        obstacles.every(obstacle=>obstacle.axis.dot(normal)<Math.cos(obstacle.angle+(size+.065)/2.56)),
      plant:(parent,normal,yaw)=>{
        const root=new Group();
        const lon=Math.atan2(normal.x,normal.z), lat=Math.asin(normal.y);
        root.position.copy(normal).multiplyScalar(ground(normal).height-.012);
        root.quaternion.copy(Land.frame(lon,lat).rotation);
        root.rotateY(yaw);
        parent.add(root);
        return root;
      }
    });
    for(const {patch,size} of loose) {
      if(roam.passesNear(patch.position,.175+size)) patch.removeFromParent();
    }
    batchRepeatedParts(forest);
    const nod=snowFigure(snowman);
    const moonlight=new THREE.PointLight('#c7d5fc',.38,1.75,2);
    moonlight.position.set(-.47,1.39,.94);
    rear.add(moonlight);
    const starts={duel:0,yoda:0,penguins:0,valley:0};
    group.userData.replay=(arena,seconds)=>{starts[arena]=seconds;};
    group.userData.resetScenes=()=>{starts.duel=starts.yoda=starts.penguins=starts.valley=0;};
    group.userData.animate=(seconds,front=0,viewer,orbitVisible=false)=>{
      let rapid=false;
      if(front>=-.25) {
        const t=(seconds-starts.duel)%cycle;
        sample(t,'left',left);
        sample(t,'right',right);
        warm.update(t,left,right);
        cold.update(t,right,left);
        const impact=flare(t);
        red.update(t,left,'left',impact);
        blue.update(t,right,'right',impact);
        rapid=t>.75 && t<12.6;
        snow(seconds);
      }
      if(front<=.25) {
        const active=animateEncounter(seconds-starts.yoda);
        rapid=rapid || active;
        rearSnow(seconds);
      }
      const campVisible=!viewer || viewer.dot(campAxis)>.30;
      visitPenguins(seconds-starts.penguins,campVisible);
      visitValley(seconds-starts.valley,!viewer || viewer.dot(valleyAxis)>.27);
      roam(seconds);
      nod(seconds);
      chase(seconds,viewer,orbitVisible);
      group.userData.rapidMotion=rapid || Boolean(viewer && campVisible) || orbitVisible;
    };
    group.userData.animate(0);
    return group;
  }

  return {create};
})();

;
const StoryWorlds = (() => {
  const { Color, Group, Mesh, Vector2, Vector3 } = THREE;
  const { clamp, lerp, smoothstep } = THREE.MathUtils;
  const { model, batchRepeatedParts } = Scenery;
  const tau = Land.tau;
  const shadow = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const lowShade = new THREE.MeshBasicMaterial({ color: '#24182f', transparent: true, opacity: .19, depthWrite: false });

  function lathe(profile, segments=14) {
    return new THREE.LatheGeometry(profile.map(([x,y]) => new Vector2(x,y)),segments);
  }

  function tube(points,radius,steps=9) {
    const curve=new THREE.CatmullRomCurve3(points.map(point=>new Vector3(...point)));
    return new THREE.TubeGeometry(curve,steps,radius,5,false);
  }

  function sphere(group, radius, paint) {
    const terrain = Land.globeGeometry(112, 60, (lon,lat) => {
      const normal = Land.direction(lon,lat);
      const { height,color } = paint(normal);
      return { position: normal.multiplyScalar(radius+height),color };
    });
    const globe=new Mesh(terrain,new THREE.MeshStandardMaterial({ vertexColors:true,roughness:.96 }));
    globe.receiveShadow=true;
    globe.castShadow=true;
    group.add(globe);

    function put(object,lon,lat,lift=0,yaw=0) {
      const normal=Land.direction(lon,lat);
      object.position.copy(normal).multiplyScalar(radius+paint(normal).height+lift);
      object.quaternion.copy(Land.frame(lon,lat).rotation);
      object.rotateY(yaw);
      return object;
    }

    function place(parent,lon,lat,lift=0,yaw=0) {
      const site=put(new Group(),lon,lat,lift,yaw);
      parent.add(site);
      return site;
    }

    return {put,place};
  }

  function trailPose(stops,time) {
    let i=1;
    while(i<stops.length-1 && time>stops[i][0]) i++;
    const [start,a,b,turn]=stops[i-1];
    const [end,c,d,direction]=stops[i];
    const t=clamp((time-start)/(end-start),0,1);
    const amount=lerp(t,smoothstep(t,0,1),.38);
    const delta=THREE.MathUtils.euclideanModulo(direction-turn+Math.PI,tau)-Math.PI;
    return {
      lon:lerp(a,c,amount),lat:lerp(b,d,amount),yaw:turn+delta*smoothstep(t,0,1),
      pace:a===c && b===d ? 0 : .85*(smoothstep(t,0,.13)-smoothstep(t,.88,1))
    };
  }

  function crystal(parent,size,angle,light) {
    const crystals=new Group();
    crystals.rotation.y=angle;
    crystals.scale.setScalar(size);
    parent.add(crystals);
    model(crystals,'pebble','#514462',[0,.042,0],[.33,.105,.24]);
    const shard=lathe([[0,0],[.102,.06],[.091,.31],[.040,.43],[0,.49]],5);
    for(let i=0;i<5;i++) {
      const a=i*2.40;
      const scale=i===0?1:1-i*.116;
      model(crystals,shard,i%2===0?light:'#659bb8',
        [Math.cos(a)*i*.056,.04,Math.sin(a)*i*.039],
        [scale,scale,scale],[.17*Math.sin(a),i*.71,(i-2)*.13]);
    }
    return crystals;
  }

  function coverView(site,elevation) {
    const heading=new Vector3(0,elevation,1).applyQuaternion(site.quaternion).normalize();
    const vertical=new Vector3(0,1,0).applyQuaternion(site.quaternion);
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(heading,new Vector3(),vertical)
    );
  }

  function spore() {
    const group=new Group();
    const solid=new Group();
    group.add(solid);
    const random=Land.rng(67048);
    const plum=new Color('#3f3458'), violet=new Color('#715580'), clay=new Color('#936572'), basalt=new Color('#33283f');
    const pits=[[-.63,-.23,.16,42],[1.72,.39,.23,36],[-2.16,-.34,.26,31]].map(([lon,lat,depth,falloff]) =>
      ({ center:Land.direction(lon,lat),depth,falloff }));
    const sentinel=Land.direction(.50,.31);
    const terrain=sphere(group,3.04,n=>{
      const {x,y,z}=n;
      const ridge=.103*Math.sin(7.1*x-4*z+3*y)*Math.sin(6*y+4*z)+.057*Math.cos(13*z-5*x+1.6*y);
      const mineralSeam=Math.abs(y+.24*Math.sin(x*3.7+z*2.1)-.11*Math.sin(z*6-3*x));
      const mineralTint=1-smoothstep(mineralSeam,.019,.127);
      const hollow=pits.reduce((sum,{center,depth,falloff})=>sum+depth*Math.exp((n.dot(center)-1)*falloff),0);
      const rise=.29*Math.exp((n.dot(sentinel)-1)*16);
      const color=plum.clone().lerp(violet,clamp(.49+ridge*2.25+rise,0,1));
      color.lerp(clay,.58*smoothstep(Math.sin(x*6-y*4+z*6),.22,1));
      color.lerp(basalt,clamp(hollow*2.05+mineralTint*.46,0,.68));
      return {height:ridge+rise-hollow+mineralTint*.046,color};
    });

    const cap=lathe([[0,.023],[.226,0],[.340,.027],[.349,.076],[.282,.169],[.174,.261],[0,.29]],15);
    const under=lathe([[0,0],[.245,.016],[.318,.031],[.327,.043]],15);
    const luminous=new THREE.MeshStandardMaterial({ color:'#9bdedb',emissive:'#69bbce',emissiveIntensity:.54,roughness:.70 });
    const crystalLight=new THREE.MeshStandardMaterial({ color:'#6ecbcc',emissive:'#4a96bc',emissiveIntensity:.43,roughness:.58,flatShading:true });
    const rootColors=['#885c8d','#6a729e','#b87091','#7c639b','#9a77a5'];
    const caps=[
      [-.86,.45,1.26,-.22],[.55,.54,1.49,.19],[.87,.34,1.02,-.16],[-.99,.14,.81,.25],
      [1.91,-.32,1.29,.24],[2.36,.22,1.39,-.20],[-2.28,-.24,1.41,.22],[-1.72,.71,1.18,-.14],
      [-.66,-.57,.83,.24],[.74,-.49,.96,-.26],[2.88,-.66,1.27,.11],[-2.79,.58,.98,-.18]
    ];
    for(const [index,[lon,lat,size,tilt]] of caps.entries()) {
      const patch=terrain.place(solid,lon,lat,.014,index*.56);
      model(patch,shadow,lowShade,[0,.017,0],[size*.34,1,size*.24]);
      for(let j=0;j<3;j++) {
        const mushroom=new Group();
        mushroom.rotation.z=tilt+(j-.9)*.17;
        mushroom.position.set(j===0?0:(j===1?-.25:.21),.003,j===0?0:(j===1?.08:-.19));
        const scale=j===0?size:size*(.48+j*.10);
        mushroom.scale.setScalar(scale);
        patch.add(mushroom);
        const height=.48+random()*.26;
        model(mushroom,'stem','#b982a3',[0,height*.43,0],[.105,height,.106],[.04,0,.075]);
        model(mushroom,under,'#b996bb',[0,height*.92,0],[1,1,1]);
        model(mushroom,cap,rootColors[(index+j)%rootColors.length],[0,height*.94,0],[1,1,1],[.07,-.4,-.15]);
        for(let k=0;k<5;k++) {
          const a=k*tau/5+index;
          const edge=k%2===0?.246:.303;
          model(mushroom,'tiny',luminous,[Math.cos(a)*edge,height*.94+.035+(.303-edge)*.89,Math.sin(a)*edge],
            [.031+k%2*.009,.025,.032],[0,a,.13]);
        }
      }
    }

    const crystalSites=[
      [.44,.13,.97],[.64,.06,.79],[-.48,.33,.77],[-.99,-.43,.63],[.18,-.57,.94],[-1.47,.21,.58],
      [2.17,.46,1.11],[-2.25,-.12,.92],[2.62,-.35,.83],[-2.60,.29,.69],[3.04,-.70,.78],[1.62,.83,.75]
    ];
    for(const [i,[lon,lat,size]] of crystalSites.entries()) crystal(terrain.place(solid,lon,lat),size,i*.69,crystalLight);

    const leaves=['#786a9b','#627fa4','#ba7f9b','#6b98a6'];
    for(let i=0;i<105;i++) {
      const lon=(i*2.39996)%tau;
      const lat=Math.asin((i+.5)/52.5-1);
      if(Math.abs(Math.sin(lon+.1))<.52 && Math.cos(lon)>0 && Math.abs(lat+.09)<.25) continue;
      const patch=terrain.place(solid,lon,lat,0,random()*tau);
      const size=.06+random()*.13;
      for(let j=0;j<3;j++) {
        const a=j*2.4;
        const c=Math.cos(a),s=Math.sin(a);
        model(patch,'pebble',leaves[(i+j)%leaves.length],[size*c,.027,size*s],[size*.72,size*(.28+.36*random()),size*.81],[.3,a,.17]);
        if(i%4===0) {
          model(patch,'stem','#89608a',[size*c,size*.90,size*s],[.018,size*1.8,.018],[.23,0,c*.40]);
          model(patch,'tiny',j===1?luminous:'#d0a2c5',[size*c,size*1.70,size*s],[.032,.024,.032]);
        }
      }
    }

    const stem=tube([[0,0,0],[.075,.17,.025],[-.059,.31,-.012],[.042,.53,.008]],.026);
    const lampSkin=lathe([[0,0],[.12,.045],[.166,.14],[.115,.25],[0,.29]],7);
    const bulbs=[
      [-.94,-.23,.82],[.89,-.26,1.1],[-.45,.12,.68],[.16,.44,.7],
      [1.8,.28,.89],[2.46,-.12,.91],[-2.27,-.42,1.22],[-1.58,.53,.87],[-2.84,.32,1.02]
    ];
    for(const [i,[lon,lat,size]] of bulbs.entries()) {
      const plant=terrain.place(solid,lon,lat,0,i*.81);
      plant.scale.setScalar(size);
      const branches=new Group();
      plant.add(branches);
      for(const side of [-1,1]) {
        const twig=new Group();
        twig.rotation.z=side*.43;
        twig.scale.setScalar(side===1?1:.75);
        branches.add(twig);
        model(twig,stem,'#9c77ae',[0,0,0],[1,1,1]);
        const bulb=new Group();
        bulb.position.set(.041,.47,.012);
        bulb.rotation.z=-side*.36;
        twig.add(bulb);
        model(bulb,lampSkin,side===1?'#4e739a':'#596d9e',[0,0,0],[1,1,1]);
        for(let k=0;k<5;k++) {
          const turn=k*tau/5;
          model(bulb,'pebble',luminous,[.132*Math.cos(turn),.147,.131*Math.sin(turn)],
            [.059,.062,.021],[0,Math.PI/2-turn,.17]);
        }
      }
    }

    const path=[[-.60,-.13],[-.40,-.105],[-.20,-.055],[.03,-.05],[.24,.03],[.36,.103]];
    for(let i=0;i<path.length-1;i++) {
      const [a,b]=path[i], [c,d]=path[i+1];
      for(let j=0;j<4;j++) {
        const t=j/4;
        const patch=terrain.place(solid,lerp(a,c,t),lerp(b,d,t)+(j%2===0?.023:-.017),.006);
        model(patch,'pebble',j%2===0?'#8b6d8d':'#745b7b',[0,.012,0],[.128,.025,.081],[0,random()*tau,.07]);
      }
    }
    const arch=terrain.place(solid,-2.73,.08,0,.55);
    for(let i=0;i<7;i++) {
      const angle=.12+i*(Math.PI-.24)/6;
      model(arch,'pebble',i%2===0?'#654b68':'#806080',[.65*Math.cos(angle),.73*Math.sin(angle),0],
        [.26,.22,.24],[i*.17,0,angle]);
    }
    batchRepeatedParts(solid);

    const berth=terrain.place(group,-.66,-.24,.035,.27);
    berth.name='Место падения';
    group.userData.coverView=coverView(berth,.86);
    model(berth,shadow,lowShade,[0,.022,0],[.59,1,.49]);
    const ship=new Group();
    ship.name='Упавшая ракета';
    ship.position.set(.19,.48,-.045);
    group.userData.demoFocus=ship.position.clone().applyQuaternion(berth.quaternion).add(berth.position);
    ship.rotation.set(-.14,-.47,2.02);
    berth.add(ship);
    const chassis=lathe([[0,.15],[.231,.15],[.29,.26],[.287,.61],[.229,.78],[.108,.87],[0,.89]],18);
    model(ship,chassis,'#e6cec7',[0,0,0],[1,1,1]);
    model(ship,lathe([[.239,.720],[.207,.798],[.109,.875],[0,.90]],18),'#d17a5b',[0,0,0],[1.065,1,1.065]);
    model(ship,lathe([[.098,.055],[.147,.065],[.177,.167],[.231,.178]],10),'#716576',[0,0,0],[1,1,1]);
    model(ship,'pebble','#3f3a50',[0,.072,0],[.102,.034,.102]);
    model(ship,'round','#54546e',[0,.59,.243],[.182,.121,.073],[.25,0,0]);
    model(ship,'round','#6fa8be',[0,.594,.294],[.143,.087,.035],[.25,0,0]);
    model(ship,'tiny','#c6d7d7',[-.059,.633,.322],[.057,.022,.009],[0,0,.19]);
    const signal=new THREE.MeshStandardMaterial({color:'#f8bf87',emissive:'#e79458',emissiveIntensity:.68,roughness:.65});
    model(ship,'round',signal,[.193,.277,.217],[.041,.036,.027]);
    for(let i=0;i<3;i++) {
      const a=i*tau/3;
      model(berth,'pebble','#8d6a79',[Math.cos(a)*.45,.005,Math.sin(a)*.45],[.197,.056,.126],[0,a,.13]);
      model(ship,'box','#be735d',[Math.cos(a)*.258,.115,Math.sin(a)*.258],[.162,.094,.117],[0,-a,0]);
      model(ship,'box','#ae685d',[Math.cos(a)*.289,.194,Math.sin(a)*.289],[.21,.089,.10],[.26,-a,-.61]);
    }
    batchRepeatedParts(berth);
    const vent=berth.worldToLocal(ship.localToWorld(new Vector3(0,.044,0)));
    const smoke=Array.from({length:8},(_,i)=>{
      const material=new THREE.MeshBasicMaterial({
        color:i%2===0?'#c0a5ba':'#d1b7c4',transparent:true,opacity:0,depthWrite:false
      });
      const puff=model(berth,'round',material,[0,0,0],[.1,.1,.1]);
      puff.name='Дым двигателя';
      puff.castShadow=false;
      return puff;
    });

    const scout=Inhabitants.resident(group,'maker',1.22);
    scout.base.name='Исследователь кристаллов';
    for(const part of scout.head.children) part.visible=false;
    model(scout.head,'round','#e8dcd8',[0,.028,.008],[.144,.155,.144]);
    model(scout.head,'round','#454e75',[0,.021,.130],[.106,.093,.055]);
    model(scout.head,'tiny','#b4c9e0',[-.036,.063,.172],[.041,.017,.011],[0,0,.19]);
    model(scout.torso,'box','#bb7a6f',[0,.33,-.108],[.167,.193,.089]);
    const scanner=new Group();
    scout.hands[1].add(scanner);
    scanner.position.set(0,0,.055);
    model(scanner,'box','#817287',[0,0,.034],[.074,.062,.124]);
    model(scanner,'tiny',luminous,[0,.003,.103],[.032,.023,.011]);
    const scanMaterial=new THREE.MeshBasicMaterial({color:'#93dedb',transparent:true,opacity:.17,depthWrite:false,side:THREE.DoubleSide});
    const beam=model(scanner,new THREE.ConeGeometry(.12,.51,14,1,true).rotateX(-Math.PI/2).translate(0,0,.35),
      scanMaterial,[0,0,0],[1,1,1]);
    beam.castShadow=false;
    const visitor=new Group();
    visitor.name='Одноглазая медуза';
    group.add(visitor);
    const mantle=model(visitor,'pebble','#597fa8',[0,.163,0],[.158,.157,.148],[.14,.2,.09]);
    model(visitor,'round','#d5d6df',[0,.185,.119],[.070,.080,.051]);
    const iris=model(visitor,'tiny','#34394f',[.011,.185,.163],[.036,.047,.021]);
    model(visitor,'tiny','#dfadbd',[-.007,.200,.182],[.014,.015,.008]);
    const curls=new Group();
    visitor.add(curls);
    const hook=tube([[0,0,0],[.075,.026,.007],[.138,-.054,0],[.202,-.040,.017],[.217,.024,.032],[.183,.056,.039]],.034,12);
    for(let j=0;j<5;j++) {
      const a=j*tau/5;
      const arm=model(curls,hook,j%2===0?'#668fba':'#ae789a',[.098*Math.cos(a),.097,.097*Math.sin(a)],
        [1,1,1],[0,-a,.14*Math.sin(a)]);
      arm.userData.direction=a;
    }
    model(visitor,hook,'#728bb6',[0,.286,-.036],[.75,.75,.75],[.30,.3,1.17]);

    const driftDirection=new Vector3();
    const sparks=Array.from({length:12},(_,i)=>({
      mote:model(group,'tiny',luminous,[0,0,0],[.019,.019,.019]),
      point:Land.direction(crystalSites[i][0],crystalSites[i][1])
    }));
    const walk=[
      [0,-.50,-.112,1.42],[2,-.50,-.112,1.34],[5.4,-.36,-.091,1.74],[8.4,-.06,-.054,1.89],
      [11.5,.31,.039,.91],[16.5,.31,.039,.85],[19.3,.26,.08,2.61],[23.6,-.08,-.04,-1.34],
      [28.5,-.50,-.112,-1.70],[31,-.50,-.112,1.42]
    ];
    const wander=[[0,.71,.34,-1.8],[11,.71,.34,-1.8],[15.2,.48,.19,-1.1],[18,.368,.097,-2.0],
      [21,.368,.097,-2.0],[24.8,.58,.15,.73],[30,.71,.34,2.9],[31,.71,.34,-1.8]];
    group.userData.animate=seconds=>{
      const t=seconds%31;
      const {lon,lat,yaw,pace}=trailPose(walk,t);
      const read=smoothstep(t,11.28,12.28)-smoothstep(t,15.68,16.60);
      terrain.put(scout.base,lon,lat,.008,yaw);
      scout.pose(seconds,pace,.23+read*.83,0,{ lookDown:read*.16,lean:read*.075 });
      scanner.rotation.x=.1+read*.30;
      beam.visible=read>.10;
      scanMaterial.opacity=read*(.10+.05*Math.sin(seconds*11));
      crystalLight.emissiveIntensity=.43+read*.53;
      signal.emissiveIntensity=.63+.27*Math.sin(seconds*3.7);
      for(const [i,puff] of smoke.entries()) {
        const age=(seconds*.37+i/smoke.length)%1;
        const drift=.12+.37*age;
        puff.position.copy(vent);
        puff.position.x+=drift*age+.065*Math.sin(age*4+i);
        puff.position.y+=age*.84;
        puff.position.z-=age*.27;
        puff.scale.set(.076+age*.176,.066+age*.118,.056+age*.137);
        puff.rotation.set(age*.74,i*.96,age*1.31);
        puff.material.opacity=(1-age)**1.7*smoothstep(age,0,.14)*.47;
      }
      const little=trailPose(wander,t);
      terrain.put(visitor,little.lon,little.lat,.14+.092*Math.sin(seconds*3.7)+little.pace*.18,little.yaw);
      const appear=smoothstep(t,11,14)-smoothstep(t,28,31);
      visitor.scale.setScalar(.86+.17*appear);
      mantle.scale.y=.157*(1+.09*Math.sin(seconds*3.7));
      for(const [i,arm] of curls.children.entries()) {
        arm.rotation.y=-arm.userData.direction+.14*Math.sin(seconds*3.7+i);
        arm.rotation.z=.23*Math.sin(seconds*3.7+i)+little.pace*.37*Math.sin(seconds*6.1+i);
      }
      iris.scale.y=.047*(1-.78*Math.pow(Math.max(0,Math.cos(seconds*1.35)),48));
      for(const [i,{mote,point}] of sparks.entries()) {
        const a=seconds*(.50+i*.014)+i*2.33;
        mote.position.copy(point).multiplyScalar(3.40+.144*Math.sin(a*.71))
          .addScaledVector(driftDirection.set(Math.sin(a),Math.cos(a*.42),Math.sin(a*.81)),.12);
        mote.scale.setScalar(.011+(.5+.5*Math.sin(a*2))*(i===0?.017:.012));
      }
    };
    group.userData.animate(0);
    return group;
  }

  function rosePetal() {
    const positions=[], indices=[];
    for(let j=0;j<=6;j++) {
      const t=j/6;
      for(let i=0;i<=6;i++) {
        const u=(i-3)/3;
        positions.push(u*(.022+.118*Math.sin(t*2.38)),
          t*.173+u*u*(.045*t)-.028*Math.sin(t*Math.PI),
          t*.140-.064*t**5-.037*u*u*t);
        if(i<6 && j<6) {
          const start=j*7+i;
          indices.push(start,start+1,start+7,start+1,start+8,start+7);
        }
      }
    }
    const surface=new THREE.BufferGeometry();
    surface.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    surface.setIndex(indices);
    surface.computeVertexNormals();
    return surface;
  }

  function rose() {
    const group=new Group();
    const ground=new Group();
    group.add(ground);
    const random=Land.rng(612);
    const honey=new Color('#b2846c'), blush=new Color('#d9ac86'), sage=new Color('#a3a367'), ash=new Color('#85677b');
    const craters=[[-.96,.14,.24],[1.67,-.18,.17],[-2.29,.39,.25]].map(([lon,lat,size])=>
      ({ center:Land.direction(lon,lat),size }));
    const garden=Land.direction(.62,.98);
    const terrain=sphere(group,2.21,n=>{
      const {x,y,z}=n;
      const ridge=.038*Math.sin(10*x+6*y)*Math.cos(z*7-y*5)+.029*Math.sin(5*x-7*z);
      const ring=Math.sin((y+.29*Math.sin(3*x+z))*8.7);
      let depression=0, raised=0;
      for(const {center,size} of craters) {
        const distance=(1-n.dot(center))/(size*size);
        depression+=.14*(1-smoothstep(distance,.11,.89));
        raised+=.093*Math.exp(-(((distance-.90)/.40)**2));
      }
      const color=honey.clone().lerp(blush,clamp(.57+ridge*4+ring*.18,0,1));
      color.lerp(sage,.68*smoothstep(Math.sin(x*7+y*3+z*4),.28,1));
      color.lerp(sage,.63*Math.exp((n.dot(garden)-1)*27));
      color.lerp(ash,clamp(depression*3.6+raised*1.68,0,.88));
      return {height:ridge+raised-depression,color};
    });
    const dust=['#c3a07c','#c59b84','#ad8b7c','#d7b488'];
    const sprigs=['#ac9b65','#c6aa72','#c3b483'];
    for(let i=0;i<89;i++) {
      const lon=((i*2.399963)%tau)-Math.PI;
      const lat=Math.asin((i+.5)/44.5-1);
      if(Math.abs(lon)<.69 && lat>-.40 && lat<.60) continue;
      const patch=terrain.place(ground,lon,lat,0,random()*tau);
      const size=.048+random()*.095;
      for(let j=0;j<3;j++) {
        const angle=j*2.4;
        model(patch,'pebble',dust[(i+j)%4],[Math.sin(angle)*size,.015,Math.cos(angle)*size],
          [size*.71,size*.42,size*.91],[.19,angle,.13]);
        if(i%3===0) {
          const height=.11+random()*.16;
          model(patch,'stem',sprigs[j],[Math.sin(angle)*.085,height*.47,Math.cos(angle)*.081],[.011,height,.013],
            [.16,0,.20+angle*.062]);
          model(patch,'pebble',j===1?'#d7b687':'#b8ad77',[Math.sin(angle)*.09,height*.94,Math.cos(angle)*.081],
            [.025,.047,.021],[.27,0,-.19]);
        }
      }
    }
    const dormant=lathe([[0,0],[.37,0],[.35,.09],[.31,.14],[.237,.27],[.172,.391],
      [.121,.42],[.083,.38],[.080,.281],[0,.25]],18);
    const vents=[];
    for(const [i,[lon,lat,scale]] of [[-.96,.14,1.20],[1.67,-.18,.76],[-2.29,.39,1.02]].entries()) {
      const site=terrain.place(ground,lon,lat,.095,1.3*i);
      site.name='Вулкан Б-612';
      site.scale.setScalar(scale);
      model(site,shadow,lowShade,[0,-.007,0],[.45,1,.42]);
      model(site,dormant,i%2===0?'#876476':'#ae8480',[0,0,0],[1,1,1],[.10,0,-.085]);
      model(site,'round',i===1?'#876f7e':'#b28074',[.009,.269,.023],[.103,.038,.095]);
      if(i===0 || i===2) {
        vents.push(site);
        const glow=new THREE.MeshStandardMaterial({color:'#c9785f',emissive:'#e57557',emissiveIntensity:.44,roughness:1});
        model(site,'round',glow,[.005,.296,.019],[.065,.023,.068]);
      }
    }
    const pavingPath=[[-.60,.53],[-.50,.44],[-.40,.34],[-.29,.21],[-.18,.30],[-.08,.42],
      [.00,.55],[.14,.64],[.23,.75],[.32,.83],[.43,.89],[.50,.94]];
    for(const [i,[lon,lat]] of pavingPath.entries()) {
      const paving=terrain.place(ground,lon,lat,.005,random()*tau);
      model(paving,'pebble',i%2===0?'#e3bd91':'#cca782',[0,.014,0],[.107,.027,.069]);
      if(i%3===1) {
        model(paving,'pebble','#acac76',[-.111,.021,.080],[.079,.030,.069]);
        model(paving,'tiny','#d1ad79',[-.135,.049,.071],[.032,.016,.027]);
      }
    }

    const lookout=terrain.place(ground,-.59,.59,.013,-1.19);
    lookout.name='Стул для закатов';
    model(lookout,shadow,lowShade,[0,.017,0],[.29,1,.27]);
    const chair=new Group();
    chair.name='Деревянный стул';
    lookout.add(chair);
    for(const side of [-1,1]) {
      for(const z of [-.112,.105]) model(chair,'stem','#a37059',[side*.105,.093,z],[.020,.186,.020],[.12,0,side*.065]);
      model(chair,'box','#bc8666',[side*.106,.291,-.123],[.026,.275,.027],[.15,0,side*.048]);
      model(chair,'box','#c99576',[side*.102,.246,.04],[.023,.028,.188],[.12,0,0]);
    }
    model(chair,'box','#c38c70',[0,.185,.012],[.255,.046,.249]);
    model(chair,'box','#e0ae8a',[0,.326,-.124],[.235,.042,.023]);
    model(chair,'box','#ce9a79',[0,.400,-.135],[.24,.067,.025],[.15,0,0]);
    model(chair,'box','#bf8279',[.034,.216,.015],[.153,.027,.16],[0,.08,0]);

    const ledge=terrain.place(ground,-.41,.64,0,.35);
    model(ledge,'pebble','#af8575',[0,.067,0],[.227,.139,.192]);
    const folio=new Group();
    folio.name='Тетрадь с ящиком для барашка';
    folio.position.set(-.005,.168,.024);
    folio.rotation.set(.06,-.36,-.07);
    ledge.add(folio);
    model(folio,'box','#88576c',[0,.003,0],[.225,.023,.148]);
    for(const side of [-1,1]) model(folio,'box','#ebd5ac',[side*.052,.018,0],[.102,.021,.133],[0,0,-side*.09]);
    model(folio,'box','#d69b66',[.030,.022,.066],[.022,.008,.057],[0,-.17,0]);
    for(let i=0;i<3;i++) {
      model(folio,'box','#ba8776',[-.055,.030,-.032+i*.026],[.062-i*.008,.005,.004]);
      model(folio,'tiny','#9c7371',[.029+i*.019,.029,.005],[.003,.002,.003]);
    }
    for(const z of [-.019,.027]) model(folio,'box','#aa7e69',[.050,.027,z],[.069,.006,.004]);
    for(const x of [.015,.084]) model(folio,'box','#aa7e69',[x,.028,.004],[.004,.006,.049]);

    const dew=terrain.place(ground,-.259,.113,0,.45);
    dew.name='Чаша для росы';
    model(dew,'pebble','#b2927d',[0,.062,0],[.236,.114,.185]);
    model(dew,lathe([[.049,0],[.106,.019],[.151,.09],[.133,.10],[.118,.066],[0,.037]],18),
      '#a48b80',[0,.126,0],[1,1,1]);
    model(dew,'round','#97b8b5',[0,.215,0],[.106,.013,.105]);
    for(const [i,[lon,lat]] of [[.25,.94],[.79,.86],[1.07,.81],[-.72,.62],[-.10,.87],[-.81,-.24]].entries()) {
      const grass=terrain.place(ground,lon,lat,.005);
      const size=.17+i%3*.051;
      for(let j=0;j<4;j++) {
        model(grass,'stem',j%2===0?'#a39a5b':'#b1a46b',[(j-1.5)*.041,size*.46,0],[.015,size,.015],
          [.09+j*.11,0,-.48+j*.19]);
        model(grass,'pebble','#d3bc7e',[(j-1.5)*.071,size*.89,-.020*j],
          [.025,.053,.023],[.08,0,-.32+j*.15]);
      }
    }
    batchRepeatedParts(ground,chair);

    const weeds=terrain.place(group,.030,.211,.007,-.11);
    weeds.name='Росток баобаба';
    model(weeds,'pebble','#a77d65',[0,.008,0],[.142,.038,.121]);
    const sprout=new Group();
    weeds.add(sprout);
    model(sprout,'stem','#986f55',[0,.117,0],[.026,.214,.026]);
    for(let i=0;i<4;i++) {
      const a=i*tau/4+.28;
      model(sprout,'pebble',i%2===0?'#818d5e':'#969f64',[.084*Math.cos(a),.18+i%2*.047,.084*Math.sin(a)],
        [.095,.034,.057],[.21,-a,.31]);
    }

    const planting=terrain.place(group,.62,.96,.010,-.12);
    planting.name='Роза под стеклом';
    group.userData.coverView=coverView(planting,.72);
    group.userData.demoFocus=new Vector3(0,.56,0).applyQuaternion(planting.quaternion).add(planting.position);
    model(planting,shadow,lowShade,[0,.011,0],[.47,1,.435]);
    model(planting,'pebble','#a28463',[0,.018,0],[.418,.081,.379]);
    model(planting,'pebble','#96956c',[.072,.034,-.015],[.382,.064,.348]);
    for(let i=0;i<12;i++) {
      const turn=i*tau/12;
      model(planting,'pebble',dust[i%4],[.408*Math.cos(turn),.047,.409*Math.sin(turn)],
        [.066,.065,.057],[.19,turn,.23]);
    }
    const flower=new Group();
    planting.add(flower);
    const stalk=tube([[0,.039,0],[.063,.27,.012],[-.045,.54,-.019],[.023,.82,.012]],.032,13);
    model(flower,stalk,'#627e58',[0,0,0],[1,1,1]);
    for(const side of [-1,1]) {
      model(flower,'pebble',side===1?'#7aa16a':'#829465',[side*.145,.32+side*.105,.024],
        [.171,.046,.069],[.19,0,side*.40]);
      for(let i=0;i<2;i++) {
        model(flower,'pebble','#879167',[side*.048,.24+i*.24+side*.038,.024],
          [.039,.022,.021],[0,0,side*.65]);
      }
    }
    const bloom=new Group();
    bloom.position.set(.018,.81,.010);
    flower.add(bloom);
    const petal=rosePetal();
    const petalColors=['#c13761','#db4872','#e35275','#ec6a83','#f0798e'].map(color=>
      new THREE.MeshStandardMaterial({color,roughness:.61,side:THREE.DoubleSide}));
    for(let layer=0;layer<3;layer++) for(let n=0;n<7-layer;n++) {
      const turn=n*tau/(7-layer)+layer*.49;
      const spread=.095-layer*.030;
      const size=1.48-layer*.29;
      model(bloom,petal,petalColors[(n%3+layer)%petalColors.length],
        [spread*Math.sin(turn),.010+layer*.042,spread*Math.cos(turn)],
        [size,size,size],[.20-layer*.15,turn,0]);
    }
    model(bloom,'round','#b83561',[0,.164,0],[.108,.089,.107]);
    model(bloom,petal,petalColors[4],[-.025,.085,.027],[.62,.79,.52],[-.26,-1.51,.02]);

    const cloche=new Group();
    cloche.name='Стеклянный колпак';
    planting.add(cloche);
    const glass=new THREE.MeshPhysicalMaterial({
      color:'#fdead5',transparent:true,opacity:.63,metalness:.03,roughness:.18,depthWrite:false
    });
    glass.onBeforeCompile=shader=>{
      const rim=[
        'float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.8);',
        'diffuseColor.a *= 0.13 + 0.87 * rim;',
        '#include <alphatest_fragment>'
      ].join('\n');
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',rim);
    };
    const bell=lathe([[.378,.049],[.378,.69],[.367,.93],[.331,1.128],[.235,1.268],[.099,1.315],[0,1.326]],36);
    const shell=model(cloche,bell,glass,[0,0,0],[1,1,1]);
    shell.renderOrder=5;
    shell.castShadow=false;
    const glassEdge=new THREE.MeshStandardMaterial({color:'#f4d8b8',transparent:true,opacity:.57,roughness:.35,depthWrite:false});
    model(cloche,new THREE.TorusGeometry(.379,.012,7,36).rotateX(-Math.PI/2),glassEdge,[0,.052,0],[1,1,1]).renderOrder=6;
    const glint=new THREE.MeshBasicMaterial({color:'#fff4dd',transparent:true,opacity:.87,depthWrite:false});
    model(cloche,tube([[-.267,.204,.267],[-.267,.63,.267],[-.254,.92,.261],[-.199,1.14,.239]],.010,16),
      glint,[0,0,0],[1,1,1]).renderOrder=7;
    model(cloche,tube([[.264,.76,.270],[.255,.94,.258],[.204,1.092,.246]],.006,12),
      glint,[0,0,0],[1,1,1]).renderOrder=7;
    model(cloche,'round','#d9ba9c',[0,1.337,0],[.063,.032,.061]);
    model(cloche,new THREE.TorusGeometry(.047,.012,7,16),glassEdge,[0,1.379,0],[1,.84,1],[0,.2,0]).renderOrder=7;
    const screen=terrain.place(group,1.03,1.09,0,-.526);
    screen.name='Ширма от ветра';
    for(const side of [-1,1]) {
      model(screen,'stem','#9b7360',[side*.176,.214,0],[.015,.43,.014]);
      model(screen,'tiny','#dcc095',[side*.176,.426,0],[.025,.025,.025]);
    }
    for(let i=0;i<5;i++) model(screen,'box',i%2===0?'#d7af9d':'#e5bfab',
      [(i-2)*.062,.225,.018*Math.cos(i*Math.PI)],[.070,.275,.038],[.04,0,i%2===0?.08:-.064]);

    const boy=Inhabitants.resident(group,'stargazer',1.34);
    boy.base.name='Маленький принц';
    const scarfGeo=new THREE.PlaneGeometry(1,1,13,2);
    const scarfCloth=new THREE.MeshStandardMaterial({color:'#f0b44d',roughness:.90,side:THREE.DoubleSide});
    const scarf=model(boy.torso,scarfGeo,scarfCloth,[.059,.415,-.039],[1,1,1]);
    scarf.frustumCulled=false;
    const scarfPositions=scarfGeo.getAttribute('position');
    const brush=new Group();
    brush.name='Щетка для вулкана';
    boy.hands[0].add(brush);
    model(brush,'stem','#b88a68',[.008,-.18,.027],[.014,.37,.014],[.20,0,.32]);
    for(let i=0;i<4;i++) model(brush,'pebble','#a78368',[(i-1.5)*.026,-.350,.091],
      [.021,.047,.025],[.20,0,(i-1.5)*.23]);
    const can=new Group();
    can.name='Лейка';
    boy.hands[1].add(can);
    can.position.set(.016,-.039,.036);
    model(can,'round','#849e98',[0,-.026,.073],[.071,.064,.087]);
    model(can,'box','#899e98',[0,.031,.076],[.067,.017,.070]);
    const spout=tube([[0,-.035,.105],[.009,-.011,.167],[.010,.049,.213]],.014);
    model(can,spout,'#849e98',[0,0,0],[1,1,1]);
    model(can,'tiny','#c4bc96',[.011,.049,.216],[.024,.014,.025]);
    const canHandle=new THREE.TorusGeometry(.043,.009,6,14);
    model(can,canHandle,'#899e98',[0,.024,.026],[.85,1,1],[0,Math.PI/2,0]);

    const waterMat=new THREE.MeshStandardMaterial({color:'#cde1d2',roughness:.53,emissive:'#8bb7b7',emissiveIntensity:.36});
    const drops=Array.from({length:9},()=>model(planting,'tiny',waterMat,[0,0,0],[.017,.023,.018]));
    drops.forEach(drop=>{drop.name='Капля из лейки';});
    const dewDrops=Array.from({length:5},()=>model(dew,'tiny',waterMat,[0,0,0],[.015,.024,.015]));
    const soot=vents.flatMap((vent,i)=>Array.from({length:4},(_,j)=>{
      const material=new THREE.MeshBasicMaterial({color:'#e1c0b3',transparent:true,opacity:0,depthWrite:false});
      const puff=model(vent,'pebble',material,[0,0,0],[.065,.065,.066],[0,i+j*.8,0]);
      puff.castShadow=false;
      return puff;
    }));
    const motes=Array.from({length:5},()=>model(planting,'tiny','#f1d6a0',[0,0,0],[.013,.013,.013]));
    const crawler=new Group();
    crawler.name='Гусеница у розы';
    planting.add(crawler);
    for(let i=0;i<6;i++) model(crawler,'tiny',i===0?'#a5aa71':'#838f65',[0,.014,.023*i],[.021,.020,.024]);
    const wings=new Group();
    wings.name='Бабочка у ширмы';
    screen.add(wings);
    const flutter=Scenery.butterflies(wings,[[0,0]],()=>({
      position:new Vector3(.009,.66,.085),rotation:new THREE.Quaternion()
    }),['#f1d494']);
    const rest=[
      [0,.327,.854,1.15],[3.4,.327,.854,1.36],[5.8,.015,.475,-.64],[8.2,-.176,.188,2.65],
      [9.7,-.176,.188,2.65],[12.1,.095,.577,.97],[13.7,.327,.854,1.15],[23.8,.327,.854,1.10],
      [26.7,.127,.257,-1.82],[28.4,.127,.257,-1.92],[32.9,-.796,.154,-1.67],[34.6,-.796,.154,-1.62],
      [37.8,-.59,.59,-1.20],[45,-.59,.59,-1.20],[47,-.229,.675,1.28],[50,.327,.854,1.15]
    ];
    const nozzle=new Vector3(), target=new Vector3(.08,.088,.006);
    const cycleSpan=50;
    group.userData.animate=seconds=>{
      const t=seconds%cycleSpan;
      const {lon,lat,yaw,pace}=trailPose(rest,t);
      const seated=.90*(smoothstep(t,37.5,38.8)-smoothstep(t,44.0,45.0));
      const speak=(1-smoothstep(t,2.3,3.25))+
        smoothstep(t,19.91,20.24)-smoothstep(t,21.22,21.86);
      const fill=smoothstep(t,8.11,8.60)-smoothstep(t,9.36,9.94);
      const lift=smoothstep(t,13.91,14.53)-smoothstep(t,15.23,15.91)+
        smoothstep(t,21.64,22.25)-smoothstep(t,22.95,23.53);
      const pour=smoothstep(t,16.11,16.76)-smoothstep(t,19.57,20.16);
      const uncovered=smoothstep(t,14.16,15.63)-smoothstep(t,22.13,23.21);
      const warmed=smoothstep(t,16.95,19.29)-smoothstep(t,27,39);
      const pull=smoothstep(t,26.44,27.20)-smoothstep(t,28.01,28.49);
      const clean=smoothstep(t,32.55,33.10)-smoothstep(t,34.16,34.75);
      const sitLight=smoothstep(t,37.82,44.64)-smoothstep(t,45.72,49.86);
      group.userData.sunset=sitLight;
      terrain.put(boy.base,lon,lat,.008+seated*.216,yaw);
      boy.pose(seconds,pace,.13+.77*pour+.66*fill+.29*speak+.41*pull,0,{
        seated,leftReach:lift*.93+clean*(.58+.28*Math.sin(seconds*11)),
        leftRoll:-lift*.20,lean:.19*pour+.15*fill+.17*clean+.22*pull,lookDown:.16*(pour+fill+pull+clean)-speak*.13,
        lookAside:seated*.28+speak*.12,rightRoll:-speak*(.31+.115*Math.sin(seconds*4))
      });
      for(let i=0;i<scarfPositions.count;i++) {
        const u=(i%14)/13;
        const v=(Math.floor(i/14)-1)*.075;
        scarfPositions.setXYZ(i,.13*u+v,.013+v*.48+
          Math.sin(seconds*3.6-u*5.91)*(.089*u)+.073*u,-.52*u+.14*u*u);
      }
      scarfPositions.needsUpdate=true;
      scarfGeo.computeVertexNormals();
      const slide=smoothstep(t,37.55,38.64)-smoothstep(t,44.1,45.5);
      chair.position.z=-.098*slide;
      brush.visible=clean>.1;
      brush.rotation.z=.34*Math.sin(seconds*11);
      can.visible=fill>.048 || (t>=9.6 && t<20.05);
      can.rotation.set(.16+.62*pour-.22*fill,0,.13*pour);
      cloche.position.set(.69*uncovered,.39*Math.sin(Math.PI*uncovered),.09*uncovered);
      cloche.rotation.z=-.18*Math.sin(Math.PI*uncovered);
      flower.rotation.z=.049*Math.sin(seconds*2.37)+speak*.068*Math.sin(seconds*3.4)+.036*warmed*Math.sin(seconds*4.1);
      bloom.scale.setScalar(1+.072*warmed);
      sprout.visible=t<28.27 || t>48.5;
      sprout.position.y=.19*(smoothstep(t,27.08,27.77)-smoothstep(t,28.08,28.25));
      sprout.rotation.z=-.62*pull;
      sprout.scale.setScalar(t<48.5?1:.30+.70*smoothstep(t,48.5,50));
      planting.worldToLocal(can.localToWorld(nozzle.set(.011,.052,.230)));
      for(const [i,drop] of drops.entries()) {
        const age=(seconds*2.6+i/drops.length)%1;
        drop.visible=pour>.12;
        drop.position.copy(nozzle).lerp(target,age);
        drop.position.y+=.09*Math.sin(age*Math.PI);
        drop.position.x+=.042*Math.sin(i*2.4)*age;
        drop.scale.setScalar(.013+.006*Math.sin(age*Math.PI));
      }
      for(const [i,drop] of dewDrops.entries()) {
        const age=(seconds*2.3+i/dewDrops.length)%1;
        drop.visible=fill>.1;
        drop.position.set(.072+.016*i,.234+.101*Math.sin(age*Math.PI),-.08+.17*age);
      }
      for(const [i,puff] of soot.entries()) {
        const age=(seconds*.27+i/4)%1;
        puff.position.set(age*.15,.43+.58*age,-.14*age+i*.003);
        puff.scale.setScalar(.052+.138*age);
        puff.material.opacity=(.26+.28*clean)*(1-age)*smoothstep(age,0,.12);
      }
      crawler.position.set(.225+.065*Math.sin(seconds*.90),.103,.191+.079*Math.cos(seconds*.90));
      crawler.rotation.y=seconds*.90+Math.PI*.42;
      for(const [i,segment] of crawler.children.entries()) segment.position.y=.017+.014*Math.sin(seconds*5.1+i*.71);
      wings.visible=warmed>.12;
      if(wings.visible) flutter(seconds);
      for(const [i,mote] of motes.entries()) {
        const turn=seconds*.71+i*2.4;
        mote.position.set(.42*Math.cos(turn),.35+.26*Math.sin(turn*.77+i),.27*Math.sin(turn));
        mote.scale.setScalar(.013+(.5+.5*Math.sin(turn*1.5))*.012);
      }
    };
    group.userData.animate(0);
    return group;
  }

  return {spore,rose,duel:DuelWorld.create};
})();

;
const Cosmos=(()=>{
  const {Color,Group,Vector3}=THREE;
  const {clamp,lerp,smoothstep,smootherstep}=THREE.MathUtils;
  const living={meadow:'#87c68e',shore:'#efa982',pond:'#70bfb7',clover:'#a4c89b'};
  const layout=[
    {id:'giant',title:'Banded Giant',sector:[-1.16,.025,32],radius:4.28,factor:1.0,tint:'#d3a595'},
    {id:'spore',title:'Spore Moon',sector:[-.33,.124,32],portrait:[-.144,.225,30],radius:3.96,factor:.60,tint:'#a09ad0',glow:.59,tilt:.23},
    {id:'shore',title:Atlas.regions.shore.title.join(' '),sector:[1.43,.20,28],radius:4.15,factor:.57,tint:living.shore},
    {id:'meadow',title:Atlas.regions.meadow.title.join(' '),sector:[.94,-.22,23],radius:4.15,factor:.52,tint:living.meadow},
    {id:'duel',title:'Frost Grove',sector:[-1.81,.25,26],radius:3.65,factor:.51,
      tint:'#9eadd0',glow:.42,tilt:.12,aimHeight:.60},
    {id:'amber',title:'Amber Isle',sector:[.36,-.146,36],portrait:[.146,-.292,35],radius:2.81,factor:1.05,tint:'#e1a169'},
    {id:'clover',title:Atlas.regions.clover.title.join(' '),sector:[.042,-.043,21],portrait:[.016,-.040,21],radius:4.15,factor:.57,tint:living.clover},
    {id:'pond',title:Atlas.regions.pond.title.join(' '),sector:[2.11,-.16,23],radius:4.15,factor:.51,tint:living.pond},
    {id:'rose',title:'Asteroid B-612',sector:[-2.54,-.21,19],radius:3.34,factor:.48,tint:'#ebbb9b',glow:.46,tilt:.15},
    {id:'belt',title:'Stone Belt',sector:[2.86,.29,26],radius:2.92,factor:.78,tint:'#cb8c75'}
  ];
  const up=new Vector3(0,1,0), origin=new Vector3(), screenNormal=new Vector3(0,0,1);
  const worldMinZoom=-.32;
  const arrivalFov=38, sunRadius=1.69;
  const initialElevation=.035, mapTilt=1.31;
  const sunPosition=Land.direction(-.12,.296).multiplyScalar(57);
  let glowTexture;

  function worldRadius(root) {
    let squaredRadius=0;
    root.updateWorldMatrix(true,true);
    const local=root.matrixWorld.clone().invert();
    const meshMatrix=new THREE.Matrix4(), pointMatrix=new THREE.Matrix4(), instance=new THREE.Matrix4();
    const point=new Vector3();
    function visit(part) {
      if(!part.visible || part.userData.excludeFromCoverFit) return;
      const vertices=part.isMesh && part.geometry.attributes.position;
      if(vertices) {
        meshMatrix.multiplyMatrices(local,part.matrixWorld);
        const count=part.isInstancedMesh?part.count:1;
        for(let index=0;index<count;index++) {
          pointMatrix.copy(meshMatrix);
          if(part.isInstancedMesh) {
            part.getMatrixAt(index,instance);
            pointMatrix.multiply(instance);
          }
          for(let v=0;v<vertices.count;v++) {
            point.fromBufferAttribute(vertices,v).applyMatrix4(pointMatrix);
            squaredRadius=Math.max(squaredRadius,point.lengthSq());
          }
        }
      }
      for(const child of part.children) visit(child);
    }
    for(const part of root.children) visit(part);
    return Math.sqrt(squaredRadius)+.09;
  }

  function fitDistance(radius,fov,span) {
    const tangent=Math.tan(THREE.MathUtils.degToRad(fov/2))*span;
    return radius*Math.hypot(1,1/tangent);
  }

  function frameForAtlas(camera,frame) {
    if(frame?.amount) {
      const {width,height,shift,amount}=frame;
      camera.setViewOffset(width,height,0,shift*amount,width,height);
    } else if(camera.view?.enabled) camera.clearViewOffset();
  }

  function resizeShadow(light,size) {
    const shadow=light.shadow;
    if(shadow.mapSize.x===size) return;
    shadow.mapSize.set(size,size);
    shadow.map?.dispose();
    shadow.map=null;
  }

  function halo(radius,tint,opacity=.63) {
    if(!glowTexture) {
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=128;
      const ctx=canvas.getContext('2d');
      const gradient=ctx.createRadialGradient(64,64,0,64,64,64);
      for(const [stop,alpha] of [[0,0],[.54,0],[.615,.03],[.656,.24],[.685,.46],[.73,.31],[.83,.115],[.94,.018],[1,0]]) {
        gradient.addColorStop(stop,`rgba(255,255,255,${alpha})`);
      }
      ctx.fillStyle=gradient;
      ctx.fillRect(0,0,128,128);
      glowTexture=new THREE.CanvasTexture(canvas);
    }
    const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:tint,transparent:true,opacity,
      blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    glow.scale.setScalar(radius*2.94);
    glow.name='Атмосферный ореол';
    return glow;
  }

  function solarCenter() {
    const root=new Group();
    root.name='Солнце';
    const uniforms={clock:{value:0},amount:{value:1}};
    const globe=new THREE.Mesh(new THREE.SphereGeometry(sunRadius,44,28),new THREE.ShaderMaterial({
      uniforms,transparent:true,
      vertexShader:`
        varying vec3 marble;
        varying float facing;
        void main(){
          marble=normalize(position);
          vec4 eye=modelViewMatrix*vec4(position,1.);
          facing=dot(normalize(normalMatrix*normal),normalize(-eye.xyz));
          gl_Position=projectionMatrix*eye;
        }`,
      fragmentShader:`
        uniform float clock;
        uniform float amount;
        varying vec3 marble;
        varying float facing;
        void main(){
          vec3 p=normalize(marble);
          float tide=sin(6.1*p.y + 2.2*cos(p.x*4.2-p.z*3.6) + clock*.075);
          float grain=sin(p.x*58.0+p.z*34.0)*cos(p.y*63.0-p.z*28.0);
          float cells=sin(13.0*p.x+7.0*p.y+2.1*sin(6.0*p.z+clock*.064))
            *cos(12.0*p.y+5.0*p.z-2.3*sin(8.0*p.x));
          float heat=smoothstep(-.69,.78,.67*tide+.24*cells+.095*grain);
          vec3 body=mix(vec3(.91,.27,.074),vec3(1.,.68,.27),heat);
          float limb=1.-smoothstep(.06,.54,facing);
          body=mix(body,vec3(1.,.76,.38),.62*limb);
          gl_FragColor=vec4(body,amount);
          #include <colorspace_fragment>
        }`
    }));
    const gradient=document.createElement('canvas');
    gradient.width=gradient.height=128;
    const ctx=gradient.getContext('2d');
    const glow=ctx.createRadialGradient(64,64,0,64,64,64);
    for(const [offset,alpha] of [[0,.87],[.28,.73],[.42,.33],[.64,.10],[.86,.02],[1,0]]) {
      glow.addColorStop(offset,`rgba(255,255,255,${alpha})`);
    }
    ctx.fillStyle=glow;
    ctx.fillRect(0,0,128,128);
    const light=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(gradient),color:'#ffb45e',
      transparent:true,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}));
    light.scale.setScalar(6.9);
    const illumination=new THREE.PointLight('#ffdbad',.49,0,0);
    root.add(globe,light,illumination);
    return {root,globe,light,illumination,uniforms};
  }

  function backgroundStars(scene) {
    const random=Land.rng(18561), coordinates=[],colors=[];
    const shades=['#758aae','#a9a3c7','#c4d5e4','#d3bebe','#a1c1c9'];
    for(let i=0;i<345;i++) {
      const direction=Land.direction(random()*Land.tau,Math.asin(random()*2-1));
      direction.multiplyScalar(156+random()*53);
      coordinates.push(direction.x,direction.y,direction.z);
      const tint=new Color(shades[Math.floor(random()*shades.length)]).multiplyScalar(.51+random()*.47);
      colors.push(tint.r,tint.g,tint.b);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(coordinates,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const stars=new THREE.Points(geo,new THREE.PointsMaterial({color:'#fff',size:1.55,sizeAttenuation:false,
      vertexColors:true,transparent:true,opacity:.63,toneMapped:false,depthWrite:false}));
    scene.add(stars);
    return stars;
  }

  function create(atlas,links,select,deferWorlds=false) {
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(48,1,.10,1600);
    const sky=new THREE.HemisphereLight('#f6e9ff','#94a4ac',1.48);
    const key=new THREE.DirectionalLight('#fff2d7',2.35);
    const sunOffset=new Vector3(-9,11,15);
    key.position.copy(sunOffset);
    key.shadow.mapSize.set(1024,1024);
    key.shadow.normalBias=.014;
    key.shadow.bias=-.00019;
    key.shadow.radius=2.2;
    const fill=new THREE.DirectionalLight('#b9cbff',.63);
    const warmSky=sky.color.clone(), nightSky=new Color('#a5b0d3');
    const warmKey=key.color.clone(), nightKey=new Color('#bfd7ef');
    fill.position.set(12,-6,-8);
    scene.add(sky,key,fill,key.target);
    const stars=backgroundStars(scene);
    const sun=solarCenter();
    sun.root.position.copy(sunPosition);
    scene.add(sun.root);
    const map=new Map();
    for(const [index,entry] of layout.entries()) {
      const root=new Group();
      root.name=entry.title;
      scene.add(root);
      const isLiving=Boolean(living[entry.id]);
      const story=StoryWorlds[entry.id];
      const haloOpacity=isLiving ? .84 : entry.glow;
      const button=document.createElement('button');
      button.type='button';
      button.dataset.cosmicTarget=entry.id;
      button.setAttribute('aria-label',entry.title);
      button.style.setProperty('--object-tint',entry.tint);
      const label=document.createElement('span');
      label.textContent=entry.title;
      button.append(label);
      button.addEventListener('click',()=>select(entry.id));
      links.append(button);
      map.set(entry.id,{...entry,root,isLiving,story:Boolean(story),button,haloOpacity,
        opacity:1,screen:new Vector3(),anchor:new Vector3(),side:new Vector3(),rise:new Vector3(),
        driftPhase:index*2.39996,hit:0,motionTime:0});
    }
    if(!deferWorlds) for(const entry of map.values()) loadBody(entry);

    function loadBody(entry) {
      if(entry.body) return entry.body;
      const {id,isLiving,root,haloOpacity}=entry;
      const body=isLiving?atlas.getMiniature(id).clone():(StoryWorlds[id] || CosmicWorlds[id])();
      if(isLiving) {
        const {lon,lat}=Biomes.view[id];
        const flat=new THREE.Matrix4().lookAt(Land.direction(lon,lat),origin,up);
        body.quaternion.setFromRotationMatrix(flat).invert();
        body.visible=true;
      } else body.rotation.y=id==='amber'?-.13:id==='belt'?-.31:0;
      root.add(body);
      entry.body=body;
      if(haloOpacity) {
        entry.halo=halo(entry.radius,entry.tint,haloOpacity);
        root.add(entry.halo);
      }
      return body;
    }

    function preloadWorld(id,renderer) {
      const entry=map.get(id);
      loadBody(entry);
      entry.coverRadius??=worldRadius(entry.root);
      if(!renderer.compileAsync || entry.coverCompiled || entry===focused) return;
      const current=focused?.root;
      const currentVisible=current?.visible;
      const nextVisible=entry.root.visible;
      // Compile against the cover lights and the next world's own lights.
      scene.remove(entry.root);
      entry.root.visible=true;
      if(current) current.visible=false;
      try {
        entry.coverCompiled=true;
        renderer.compileAsync(entry.root,camera,scene).then(()=>{ entry.coverWarmPending=true; },()=>{ entry.coverCompiled=false; });
      } finally {
        entry.root.visible=nextVisible;
        scene.add(entry.root);
        if(current) current.visible=currentVisible;
      }
    }

    function prepareGalleryWorld(id,fit) {
      const entry=map.get(id);
      loadBody(entry);
      if(fit) entry.coverRadius??=worldRadius(entry.root);
    }

    const mapOrbit={yaw:0,elevation:initialElevation,zoom:0};
    const localOrbit={yaw:0,elevation:0,zoom:0,shot:0,roll:0};
    const mapTarget={...mapOrbit}, localTarget={...localOrbit};
    const storyView=new THREE.Quaternion(), storyGoal=new THREE.Quaternion(), storySpin=new THREE.Quaternion();
    const demoView=new THREE.Quaternion();
    const dragAxis=new Vector3(), tiltMatrix=new THREE.Matrix4();
    const travelUpTurn=new THREE.Quaternion(), travelUpBlend=new THREE.Quaternion();
    const gazeTurn=new THREE.Quaternion(), gazeBlend=new THREE.Quaternion();
    const startGaze=new Vector3(), endGaze=new Vector3(), mapDirection=new Vector3();
    const look=new Vector3(), endLook=new Vector3(), endEye=new Vector3(), stageLook=new Vector3();
    const stageDirection=new Vector3();
    const edge=new Vector3(), relative=new Vector3(), cameraUp=new Vector3();
    const sunScreen=new Vector3();
    const departureUp=new Vector3(), inverse=new THREE.Quaternion();
    const travelStart=new THREE.Spherical(), travelEnd=new THREE.Spherical(), travelOrbit=new THREE.Spherical();
    const localEye=new Vector3(), localLook=new Vector3(), localUp=new Vector3();
    const coverProjection=new THREE.Matrix4(), originalProjection=new THREE.Matrix4();
    let focused=null, journey=null, skyName=null, skyAmount=0, sunset=0;
    let coverDeparture=null;
    const coverExitCamera=camera.clone();
    const coverWarmCamera=camera.clone();
    const previousViewport=new THREE.Vector4(), previousScissor=new THREE.Vector4();
    let selectedArena='duel';
    let mapHeight=0, mapLens=.445, moving=false, previousFrame=null;
    let mapTime=0, orbitSpeed=1, mapHeld=false;
    let shadowWorld=null, shadowSize=0;

    function resize(width,height,frame,shadowSize=1024) {
      const aspect=width/height;
      const mobile=aspect<.92;
      camera.aspect=aspect;
      // Extend the scene beyond its layout slot while preserving the shot's scale and center.
      if(frame) camera.setViewOffset(width,height,frame.x,frame.y,frame.width,frame.height);
      else camera.clearViewOffset();
      resizeShadow(key,shadowSize);
      mapHeight=links.clientHeight;
      mapLens=mobile?Math.max(.48,.23/aspect):.445;
      for(const entry of map.values()) {
        const [lon,lat,distance]=mobile?(entry.portrait??entry.sector):entry.sector;
        const direction=Land.direction(lon,lat);
        entry.anchor.copy(direction).multiplyScalar(distance);
        entry.side.crossVectors(up,direction).normalize();
        entry.rise.crossVectors(direction,entry.side);
        entry.root.scale.setScalar(entry.factor*(mobile?.89:1));
      }
      updatePositions();
    }

    function updatePositions() {
      for(const {root,anchor,side,rise,driftPhase} of map.values()) {
        const swing=Math.sin(driftPhase+mapTime*.112)-Math.sin(driftPhase);
        const lift=Math.cos(driftPhase+mapTime*.093)-Math.cos(driftPhase);
        root.position.copy(anchor).addScaledVector(side,.67*swing).addScaledVector(rise,.49*lift);
      }
    }

    function placeLabels() {
      const width=mapHeight*camera.aspect;
      if(!width) return;
      const font=clamp(width*.012,10,14);
      const height=font*1.23+6;
      const entries=[...map.values()].filter(entry=>!entry.button.hidden);
      const bodies=entries.map(entry=>({
        entry,
        x:(entry.screen.x+1)*width*.5,
        y:(1-entry.screen.y)*mapHeight*.5,
        radius:entry.hit*mapHeight*.5
      }));
      const placed=[];
      for(const {entry,x,y,radius} of bodies) {
        const half=entry.title.length*font*.27+8;
        const offset=Math.max(22.5,Math.min(115,radius))+6;
        const prefer=entry.button.dataset.labelSide==='above'?['above','below']:['below','above'];
        const side=prefer.find(side=>{
          const top=side==='above'?y-offset-height:y+offset;
          const box={left:x-half,right:x+half,top,bottom:top+height};
          if(box.left<6 || box.right>width-6 || box.top<5 || box.bottom>mapHeight-5) return false;
          if(placed.some(label=>label.left<box.right && label.right>box.left &&
            label.top<box.bottom && label.bottom>box.top)) return false;
          if(bodies.some(body=>body.entry!==entry && body.x+body.radius+3>box.left && body.x-body.radius-3<box.right &&
            body.y+body.radius+3>box.top && body.y-body.radius-3<box.bottom)) return false;
          placed.push(box);
          return true;
        }) ?? 'hidden';
        if(entry.button.dataset.labelSide!==side) entry.button.dataset.labelSide=side;
      }
    }

    function orbitalEye(eye,target,orbit,distance) {
      const flat=Math.cos(orbit.elevation)*distance;
      eye.copy(target).add(relative.set(Math.sin(orbit.yaw)*flat,Math.sin(orbit.elevation)*distance,Math.cos(orbit.yaw)*flat));
    }

    function mapPose(eye,aim) {
      orbitalEye(mapDirection,origin,mapOrbit,1);
      eye.copy(mapDirection).multiplyScalar(-2.6+mapOrbit.zoom*2.8);
      aim.copy(eye).addScaledVector(mapDirection,31);
    }

    function overviewFov() {
      return THREE.MathUtils.radToDeg(2*Math.atan(mapLens*Math.exp(-.32*mapOrbit.zoom)));
    }

    function approachDistance(entry) {
      const aspect=camera.aspect;
      const wide=(aspect<.8?1.05:1.16);
      const standOff=entry.id==='duel'?3.60:entry.id==='giant'?4.18:4.22;
      const narrow=entry.id==='duel'?3.15:3.45;
      return entry.root.scale.x*(entry.isLiving?Math.max(18.85,16.15/aspect)*wide:
        entry.radius*Math.max(standOff,narrow/aspect));
    }

    function coverDistance(entry) {
      entry.coverRadius??=worldRadius(entry.root);
      return fitDistance(entry.coverRadius*entry.root.scale.x,arrivalFov,.924*Math.min(1,camera.aspect));
    }

    function localPose(entry,eye,aim,orbit,cover=false,atlasFrame) {
      aim.copy(entry.root.position);
      if(entry.id==='amber') aim.y+=entry.root.scale.x*.06;
      if(entry.id==='belt') aim.y-=entry.root.scale.x*.20;
      const atlasAmount=atlasFrame?.amount ?? 0;
      let distance=cover?coverDistance(entry):approachDistance(entry)*Math.exp(-.56*orbit.zoom);
      if(atlasAmount) {
        entry.coverRadius??=worldRadius(entry.root);
        // The Frost Grove ships move beyond the surface scenery during the chase.
        const radius=Math.max(entry.coverRadius,entry.id==='duel'?5.4:0)*entry.root.scale.x;
        distance=lerp(distance,fitDistance(radius,arrivalFov,atlasFrame.span),atlasAmount);
      }
      if(entry.story) {
        const offset=cover?0:(entry.aimHeight ?? (entry.id==='rose'?.46:0));
        if(offset) aim.addScaledVector(relative.copy(up).applyQuaternion(storyView),offset*entry.root.scale.x);
        if(!cover && orbit.shot>0 && entry.id==='duel') {
          const arena=entry.body.userData.arenas[selectedArena];
          stageLook.copy(arena.center).applyQuaternion(entry.body.quaternion)
            .multiplyScalar(entry.root.scale.x).add(entry.root.position);
          const framing=smoothstep(orbit.shot,.27,1);
          aim.lerp(stageLook,framing);
          const sceneFit=Math.max(arena.distance,3.25/camera.aspect);
          const sceneDistance=sceneFit*entry.root.scale.x*Math.exp(-.25*orbit.zoom);
          distance=lerp(distance,sceneDistance,framing);
        }
      }
      aim.lerp(entry.root.position,atlasAmount);
      if(entry.story) eye.set(0,0,1).applyQuaternion(storyView).multiplyScalar(distance).add(aim);
      else orbitalEye(eye,aim,orbit,distance);
    }

    function defaultOrbit(entry) {
      const elevation=entry.tilt ?? (entry.isLiving?0:entry.id==='giant'?.26:.46);
      return {yaw:entry.id==='belt'?-.12:0,elevation,zoom:0,shot:0,roll:0};
    }

    function prepareWorld(entry) {
      loadBody(entry);
      Object.assign(localOrbit,defaultOrbit(entry));
      if(entry.story) {
        entry.motionTime=0;
        entry.body.userData.resetScenes?.();
        orbitalEye(endEye,origin,localOrbit,1);
        storyView.setFromRotationMatrix(tiltMatrix.lookAt(endEye,origin,up));
        storyGoal.copy(storyView);
      }
      Object.assign(localTarget,localOrbit);
    }

    function focusWorld(id,cover=false) {
      const entry=map.get(id);
      if(!entry) return;
      journey=null;
      focused=entry;
      prepareWorld(entry);
      const view=cover && entry.body.userData.coverView;
      if(view) {
        storyGoal.copy(entry.body.quaternion).multiply(view);
        storyView.copy(storyGoal);
      }
      wake();
    }

    function showcaseWorld(id) {
      coverDeparture=focused;
      coverExitCamera.copy(camera);
      focusWorld(id,true);
    }

    function finishShowcaseTransition() {
      coverDeparture=null;
    }

    function resetFocused() {
      if(!focused || journey) return;
      Object.assign(localTarget,defaultOrbit(focused));
      if(focused.story) {
        orbitalEye(stageDirection,origin,localTarget,1);
        storyGoal.setFromRotationMatrix(tiltMatrix.lookAt(stageDirection,origin,up));
      }
    }

    function resetZoom() {
      localTarget.zoom=0;
    }

    function frameDemoFeature(entry,amount) {
      const {demoFocus,coverView,arenas}=entry.body.userData;
      const point=arenas?.duel.center ?? demoFocus;
      if(!point) return;
      if(!entry.demoFeature) {
        const heading=entry.id==='giant'?point.clone().add(new Vector3(-.48,-1.1,1.65)):new Vector3(-.2,.57,1);
        const rotation=arenas?.duel.rotation ?? coverView ?? new THREE.Quaternion()
          .setFromRotationMatrix(tiltMatrix.lookAt(heading,origin,up));
        entry.demoFeature={
          aim:point.clone().applyQuaternion(entry.body.quaternion),
          rotation:entry.body.quaternion.clone().multiply(rotation),
          distance:arenas?arenas.duel.distance*1.44:entry.radius*1.66
        };
      }
      const feature=entry.demoFeature;
      const scale=entry.root.scale.x;
      const distance=lerp(camera.position.distanceTo(look),feature.distance*scale*Math.max(1,.65/camera.aspect),amount);
      demoView.setFromRotationMatrix(tiltMatrix.lookAt(camera.position,look,camera.up)).slerp(feature.rotation,amount);
      look.lerp(relative.copy(feature.aim).multiplyScalar(scale).add(entry.root.position),amount);
      camera.position.set(0,0,distance).applyQuaternion(demoView).add(look);
      camera.up.copy(up).applyQuaternion(demoView);
    }

    function launch(id,now,still) {
      const entry=map.get(id);
      if(journey || focused || !entry || !entry.root.visible) return;
      prepareWorld(entry);
      Object.assign(mapTarget,mapOrbit);
      journey={entry,start:now,duration:still?0:2350,eye:camera.position.clone(),aim:look.clone(),up:camera.up.clone(),fov:camera.fov};
    }

    function back(now,still) {
      if(journey) return;
      if(!focused) {
        Object.assign(mapTarget,{yaw:mapOrbit.yaw+THREE.MathUtils.euclideanModulo(-mapOrbit.yaw+Math.PI,Land.tau)-Math.PI,
          elevation:initialElevation,zoom:0});
        return;
      }
      mapTarget.zoom=Math.min(0,mapTarget.zoom);
      mapOrbit.zoom=mapTarget.zoom;
      journey={entry:null,start:now,duration:still?0:1900,eye:camera.position.clone(),aim:look.clone(),up:camera.up.clone(),fov:camera.fov};
    }

    function fromSurface(id,surfaceCamera,surfaceLook,now,still) {
      const entry=map.get(id);
      if(!entry) return;
      loadBody(entry);
      focused=entry;
      const scale=entry.root.scale.x, orientation=entry.body.quaternion;
      camera.position.copy(surfaceCamera.position).applyQuaternion(orientation).multiplyScalar(scale).add(entry.root.position);
      look.copy(surfaceLook).applyQuaternion(orientation).multiplyScalar(scale).add(entry.root.position);
      camera.up.copy(surfaceCamera.up).applyQuaternion(orientation).normalize();
      camera.fov=arrivalFov;
      back(now,still);
    }

    function arenaShot(){return focused?.id==='duel' && localTarget.shot===1 ? selectedArena : null;}

    function watchArena(id) {
      if(journey || focused?.id!=='duel') return;
      const active=arenaShot();
      localTarget.zoom=0;
      if(!id || active) {
        localTarget.shot=0;
        orbitalEye(stageDirection,origin,defaultOrbit(focused),1);
        storyGoal.setFromRotationMatrix(tiltMatrix.lookAt(stageDirection,origin,up));
        return;
      }
      const arena=focused.body.userData.arenas[id];
      if(!arena) return;
      selectedArena=id;
      localTarget.shot=1;
      storyGoal.copy(focused.body.quaternion).multiply(arena.rotation);
      focused.body.userData.replay(id,focused.motionTime);
    }

    function orbit(dx,dy,roll=0) {
      if(journey) return;
      if(roll) {
        if(!focused) return;
        const leftShot=arenaShot();
        if(leftShot) watchArena();
        localTarget.roll+=roll;
        return leftShot;
      }
      if(focused?.story) {
        const length=Math.hypot(dx,dy);
        if(!length) return;
        const leftShot=arenaShot();
        if(leftShot) watchArena();
        dragAxis.set(-dy/length,-dx/length,0);
        if(localOrbit.roll) dragAxis.applyAxisAngle(screenNormal,localOrbit.roll);
        storySpin.setFromAxisAngle(dragAxis,Math.min(Math.PI,length*.006));
        storyGoal.multiply(storySpin).normalize();
        return leftShot;
      }
      const orbit=focused?localTarget:mapTarget;
      const slope=focused ? (focused.id==='giant'?[-.45,1.27]:[.095,1.24]) : [-mapTilt,mapTilt];
      orbit.yaw-=dx*.007;
      orbit.elevation=clamp(orbit.elevation+dy*.006,...slope);
    }

    function maxZoom() {
      return focused ? (focused.id==='giant' ? .70 : .90) : .72;
    }

    function canZoomWorld(step) {
      return Boolean(focused && !journey && (step>0 ? localTarget.zoom<maxZoom()-.001 : localTarget.zoom>worldMinZoom+.001));
    }

    function scale(step,now,still,worldOnly=false) {
      if(journey) return;
      if(arenaShot() && step<0 && localTarget.zoom<=.01) {
        watchArena();
        return;
      }
      const orbit=focused?localTarget:mapTarget;
      orbit.zoom=clamp(orbit.zoom+step,worldOnly?worldMinZoom:-.85,maxZoom());
      if(!worldOnly && focused && orbit.zoom<=-.49) back(now,still);
    }

    function name(){return journey?.entry?.title ?? (journey ? null : focused?.title) ?? null;}
    function flying(){return Boolean(journey);}
    function isClose(){return Boolean(focused);}
    function hasAnimation(){return focused?Boolean(focused.body.userData.animate):!journey&&!mapHeld;}
    function hasRapidMotion(){return Boolean(focused?.body.userData.rapidMotion);}
    function atmosphere(){return {name:skyName,opacity:skyAmount,sunset};}
    function needsFrame(){return moving;}
    function wake(){previousFrame=null;}

    function moveOrbit(orbit,goal,ease) {
      let changing=false;
      const fields=orbit===localOrbit ? ['yaw','elevation','zoom','shot','roll'] : ['yaw','elevation','zoom'];
      for(const key of fields) {
        orbit[key]=lerp(orbit[key],goal[key],ease);
        if(Math.abs(orbit[key]-goal[key])>.001) changing=true;
        else orbit[key]=goal[key];
      }
      return changing;
    }

    function fade(entry,opacity) {
      entry.root.visible=opacity>.002;
      if(!entry.root.visible) return;
      loadBody(entry);
      if(opacity===entry.opacity) return;
      entry.opacity=opacity;
      if(!entry.materials) {
        entry.materials=new Map();
        entry.parts=[];
        entry.body.traverse(part=>{
          if(!part.material || Array.isArray(part.material)) return;
          const base=part.material;
          if(!entry.materials.has(base)) {
            const material=base.clone();
            material.onBeforeCompile=base.onBeforeCompile;
            material.customProgramCacheKey=base.customProgramCacheKey;
            material.transparent=true;
            entry.materials.set(base,material);
          }
          entry.parts.push([part,base]);
        });
      }
      for(const [part,base] of entry.parts) part.material=opacity===1?base:entry.materials.get(base);
      for(const [base,material] of entry.materials) material.opacity=base.opacity*opacity;
    }

    function surfacePose(entry) {
      const scale=entry.root.scale.x;
      inverse.copy(entry.body.quaternion).invert();
      localEye.copy(camera.position).sub(entry.root.position).divideScalar(scale).applyQuaternion(inverse);
      localLook.copy(look).sub(entry.root.position).divideScalar(scale).applyQuaternion(inverse);
      localUp.copy(camera.up).applyQuaternion(inverse);
      return {id:entry.id,eye:localEye,look:localLook,up:localUp,fov:camera.fov};
    }

    function travelEye(entry,from,destination,progress,ease,fromFov,toFov) {
      const pivot=entry.root.position;
      travelStart.setFromVector3(relative.copy(from).sub(pivot));
      travelEnd.setFromVector3(relative.copy(destination).sub(pivot));
      const turn=THREE.MathUtils.euclideanModulo(travelEnd.theta-travelStart.theta+Math.PI,Land.tau)-Math.PI;
      const radius=lerp(travelStart.radius,travelEnd.radius,ease);
      const elevation=lerp(travelStart.phi,travelEnd.phi,ease)-.085*Math.sin(progress*Math.PI)**2;
      travelOrbit.set(radius,elevation,travelStart.theta+turn*ease).makeSafe();
      camera.position.setFromSpherical(travelOrbit).add(pivot);
      const startSpan=travelStart.radius*Math.tan(THREE.MathUtils.degToRad(fromFov*.5));
      const endSpan=travelEnd.radius*Math.tan(THREE.MathUtils.degToRad(toFov*.5));
      camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(lerp(startSpan,endSpan,ease)/radius));
    }

    function worldShadows(renderer,entry) {
      key.castShadow=Boolean(entry);
      if(!entry) {
        if(shadowWorld) {
          key.target.position.copy(origin);
          key.position.copy(sunOffset);
        }
        shadowWorld=null;
        return;
      }
      const size=entry.root.scale.x;
      if(shadowWorld!==entry || shadowSize!==size) {
        const reach=Math.max(5.1,entry.radius*1.21)*size;
        const distance=sunOffset.length();
        Object.assign(key.shadow.camera,{
          left:-reach,right:reach,top:reach,bottom:-reach,near:distance-reach,far:distance+reach
        });
        key.shadow.camera.updateProjectionMatrix();
        shadowWorld=entry;
        shadowSize=size;
      }
      key.target.position.copy(entry.root.position);
      key.position.copy(entry.root.position).add(sunOffset);
      renderer.shadowMap.needsUpdate=true;
    }

    function animateStory(entry,viewer,time,orbitVisible) {
      entry.motionTime+=time;
      const front=entry.body.userData.front;
      const direction=front ? relative.copy(viewer.position).sub(entry.root.position)
        .applyQuaternion(inverse.copy(entry.body.quaternion).invert()).normalize() : undefined;
      entry.body.userData.animate(entry.motionTime,direction?.dot(front),direction,orbitVisible);
    }

    function lightWorld(renderer,entry,atmosphere,surroundings,night) {
      const dusk=entry?.id==='duel' ? atmosphere : 0;
      const dark=night*atmosphere;
      sky.intensity=lerp(1.48,1.10,dusk)*lerp(1,.71,dark);
      sky.color.copy(warmSky).lerp(nightSky,dusk);
      key.intensity=(lerp(2.35,.97,dusk)-.28*surroundings)*lerp(1,.61,dark);
      key.color.copy(warmKey).lerp(nightKey,dusk);
      fill.intensity=lerp(.63,.74,dusk);
      worldShadows(renderer,entry && !entry.isLiving && atmosphere>.92 ? entry : null);
    }

    function warmCoverWorld(renderer,id) {
      const entry=map.get(id);
      if(!entry.coverWarmPending) return;
      entry.coverWarmPending=false;
      const current=focused.root;
      const currentVisible=current.visible, nextVisible=entry.root.visible;
      const scissorTest=renderer.getScissorTest();
      renderer.getViewport(previousViewport);
      renderer.getScissor(previousScissor);
      coverWarmCamera.copy(camera);
      demoView.copy(entry.body.quaternion).multiply(entry.body.userData.coverView);
      coverWarmCamera.position.set(0,0,coverDistance(entry)).applyQuaternion(demoView).add(entry.root.position);
      coverWarmCamera.up.copy(up).applyQuaternion(demoView);
      coverWarmCamera.lookAt(entry.root.position);
      current.visible=false;
      entry.root.visible=true;
      try {
        animateStory(entry,coverWarmCamera,0,true);
        lightWorld(renderer,entry,1,0,0);
        // Upload geometry and shadow programs without drawing a visible frame.
        renderer.setViewport(0,0,1,1);
        renderer.setScissor(0,0,1,1);
        renderer.setScissorTest(true);
        renderer.render(scene,coverWarmCamera);
      } finally {
        renderer.setViewport(previousViewport);
        renderer.setScissor(previousScissor);
        renderer.setScissorTest(scissorTest);
        entry.root.visible=nextVisible;
        current.visible=currentVisible;
      }
    }

    function renderCoverMotion(renderer,view,frame,motion) {
      if(!motion) {
        renderer.render(scene,view);
        return;
      }
      // Translate and roll in screen space so both worlds can share one WebGL canvas.
      const {width,height,pivotX,pivotY}=frame;
      const c=Math.cos(motion.angle), s=Math.sin(motion.angle);
      const across=s*height/width, down=-s*width/height;
      coverProjection.set(
        c,across,0,(1-c)*pivotX-across*pivotY+2*motion.x/width,
        down,c,0,(1-c)*pivotY-down*pivotX-2*motion.y/height,
        0,0,1,0,
        0,0,0,1
      );
      originalProjection.copy(view.projectionMatrix);
      view.projectionMatrix.premultiply(coverProjection);
      view.projectionMatrixInverse.copy(view.projectionMatrix).invert();
      try {
        renderer.render(scene,view);
      } finally {
        view.projectionMatrix.copy(originalProjection);
        view.projectionMatrixInverse.copy(originalProjection).invert();
      }
    }

    function renderShowcaseDeparture(renderer,time,dx,frame) {
      const entry=coverDeparture;
      focused.root.visible=false;
      fade(entry,1);
      storySpin.setFromAxisAngle(coverExitCamera.up,-dx*.006);
      coverExitCamera.position.sub(entry.root.position).applyQuaternion(storySpin).add(entry.root.position);
      coverExitCamera.lookAt(entry.root.position);
      animateStory(entry,coverExitCamera,time,true);
      lightWorld(renderer,entry,1,0,0);
      renderCoverMotion(renderer,coverExitCamera,frame,frame.outgoing);
      entry.root.visible=false;
    }

    function render(renderer,now,still,drawSurface,holding=false,night=0,lookLower=0,cover=false,atlasFrame,demoShot=0,coverFrame) {
      const time=previousFrame===null?1/30:clamp((now-previousFrame)/1000,0,.065);
      previousFrame=now;
      let arrived,progress=0;
      const landing=journey?.entry;
      const departing=journey && !landing?focused:null;
      const chosen=landing || departing || focused;
      mapHeld=holding;
      moving=false;
      if(journey) {
        const {entry,start,duration,eye:from,aim:initial,up:initialUp,fov}=journey;
        progress=still || duration===0?1:clamp((now-start)/duration,0,1);
        const ease=smootherstep(progress,0,1);
        if(entry) localPose(entry,endEye,endLook,localOrbit);
        else mapPose(endEye,endLook);
        const advance=entry?smootherstep(progress,.18,1):ease;
        travelEye(entry || departing,from,endEye,progress,advance,fov,entry?arrivalFov:overviewFov());
        startGaze.copy(initial).sub(from).normalize();
        endGaze.copy(endLook).sub(camera.position).normalize();
        gazeTurn.setFromUnitVectors(startGaze,endGaze);
        const turning=entry?smootherstep(progress,0,.62):smootherstep(progress,.23,1);
        gazeBlend.identity().slerp(gazeTurn,turning);
        look.copy(camera.position).add(startGaze.applyQuaternion(gazeBlend));
        if(departing?.story) {
          travelUpTurn.setFromUnitVectors(initialUp,up);
          travelUpBlend.identity().slerp(travelUpTurn,ease);
          camera.up.copy(initialUp).applyQuaternion(travelUpBlend);
        } else camera.up.copy(departureUp.copy(initialUp).lerp(up,ease)).normalize();
        if(progress===1) {
          focused=entry;
          if(entry?.isLiving) arrived=entry.id;
          journey=null;
        }
      } else if(focused) {
        const ease=still?1:1-Math.exp(-19*time);
        moving=moveOrbit(localOrbit,localTarget,ease);
        if(focused.story) {
          storyView.slerp(storyGoal,ease);
          if(storyView.angleTo(storyGoal)>.002) moving=true;
          else storyView.copy(storyGoal);
        }
        localPose(focused,camera.position,look,localOrbit,cover,atlasFrame);
        camera.fov=arrivalFov;
        camera.up.copy(up);
        if(focused.story) camera.up.applyQuaternion(storyView);
        look.addScaledVector(camera.up,-lookLower*focused.root.scale.x*(1-(atlasFrame?.amount ?? 0)));
        if(localOrbit.roll) {
          camera.up.applyAxisAngle(relative.copy(camera.position).sub(look).normalize(),localOrbit.roll);
        }
        if(demoShot>0) frameDemoFeature(focused,demoShot*(1-(atlasFrame?.amount ?? 0)));
      } else {
        moving=moveOrbit(mapOrbit,mapTarget,still?1:1-Math.exp(-17*time));
        mapPose(camera.position,look);
        camera.fov=overviewFov();
        camera.up.copy(up);
      }
      if(still || chosen || holding || moving) orbitSpeed=0;
      else {
        orbitSpeed=lerp(orbitSpeed,1,1-Math.exp(-4.6*time));
        mapTime+=time*orbitSpeed;
        updatePositions();
      }
      camera.lookAt(look);
      if(!cover) frameForAtlas(camera,atlasFrame);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      skyName=chosen?.id ?? null;
      skyAmount=landing?smoothstep(progress,.19,.99):departing?1-smoothstep(progress,.18,.88):focused?1:0;
      const surroundings=landing?1-smoothstep(progress,.08,.54):
        departing?smoothstep(progress,.49,.91):focused?0:1;
      sun.root.visible=surroundings>.003;
      sun.uniforms.amount.value=surroundings;
      sun.uniforms.clock.value=mapTime;
      sun.globe.material.depthWrite=surroundings>.96;
      sun.light.material.opacity=.78*surroundings;
      sun.illumination.intensity=.49*surroundings;
      stars.material.opacity=.63*(1-skyAmount);
      stars.visible=skyAmount<.998;
      stars.position.copy(camera.position);
      stars.scale.setScalar(Math.max(1,camera.position.length()/89));
      if(chosen?.story) {
        const animationTime=!still && (!landing || progress>.66)?time:0;
        const orbitVisible=skyAmount>.56 && (!focused || localOrbit.shot<.46);
        animateStory(chosen,camera,animationTime,orbitVisible);
      } else chosen?.body.userData.animate?.(now/1000);
      sunset=chosen?.body.userData.sunset ?? 0;
      lightWorld(renderer,chosen,skyAmount,surroundings,night);

      for(const entry of map.values()) {
        const {root,button,radius,screen}=entry;
        const opacity=entry===chosen?1:surroundings;
        fade(entry,opacity);
        if(entry.halo) {
          const distanceFade=entry===chosen && entry.story ? 1-smoothstep(skyAmount,.25,.95) : 1;
          entry.halo.material.opacity=entry.haloOpacity*opacity*distanceFade;
          entry.halo.visible=distanceFade>.002;
        }
        button.hidden=Boolean(focused || journey);
        if(button.hidden)continue;
        screen.copy(root.position).project(camera);
        edge.copy(root.position).addScaledVector(cameraUp.setFromMatrixColumn(camera.matrixWorld,1),radius*root.scale.x).project(camera);
        entry.hit=edge.y-screen.y;
        button.style.left=`${(screen.x+1)*50}%`;
        button.style.top=`${(1-screen.y)*50}%`;
        button.style.setProperty('--hit-size',`${entry.hit*100}vh`);
        button.style.zIndex=String(Math.max(1,Math.round((1-screen.z)*10000)));
        button.hidden=screen.x<-1.15 || screen.x>1.15 || screen.y<-1.12 || screen.y>1.12 || screen.z>1;
      }
      if(!focused && !journey) {
        sunScreen.copy(sun.root.position).project(camera);
        const sunHit=sunRadius/(camera.position.distanceTo(sun.root.position)*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5)));
        for(const {screen,button} of map.values()) {
          if(button.hidden) continue;
          if(sunScreen.z>=-1 && sunScreen.z<screen.z && Math.hypot((screen.x-sunScreen.x)*camera.aspect,screen.y-sunScreen.y)<sunHit) {
            button.hidden=true;
            continue;
          }
          for(const foreground of map.values()) {
            if(foreground.screen.z>=screen.z) continue;
            const dx=(foreground.screen.x-screen.x)*camera.aspect;
            const dy=foreground.screen.y-screen.y;
            if(dx*dx+dy*dy<(.74*foreground.hit)**2) {
              button.hidden=true;
              break;
            }
          }
        }
        placeLabels();
      }
      const showDetailed=chosen?.isLiving && (landing?progress>.66:departing?progress<.49:true);
      if(showDetailed && drawSurface) drawSurface(surfacePose(chosen),now);
      else renderCoverMotion(renderer,camera,coverFrame,coverFrame?.incoming);
      return arrived;
    }

    function cancel() {
      journey=null;
      focused=null;
      Object.assign(mapOrbit,{yaw:0,elevation:initialElevation,zoom:0});
      Object.assign(mapTarget,mapOrbit);
      wake();
    }

    let thumbnail;
    const thumbnailTargets=new Map();
    function drawThumbnail(renderer,id,canvas,turn=null) {
      if(!thumbnail) {
        const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,70);
        const key=new THREE.DirectionalLight('#fff2db',1.95);
        key.position.set(-4,6,7);
        const fill=new THREE.DirectionalLight('#a5c5f0',.66);
        fill.position.set(3,-2,4);
        scene.add(key,fill,new THREE.HemisphereLight('#edf1ff','#a7abc7',1.6));
        thumbnail={scene,camera};
      }
      const {scene:studio,camera:portrait}=thumbnail;
      const size=canvas.width, ctx=canvas.getContext('2d');
      if(!thumbnailTargets.has(size)) {
        const target=new THREE.WebGLRenderTarget(size,size);
        target.texture.colorSpace=renderer.outputColorSpace;
        thumbnailTargets.set(size,{target,pixels:new Uint8Array(size*size*4),image:ctx.createImageData(size,size)});
      }
      const {target,pixels,image}=thumbnailTargets.get(size);
      const entry=map.get(id);
      loadBody(entry);
      const {root,body,radius}=entry;
      entry.thumbnailRadius??=worldRadius(body);
      const nominal=radius*(turn===null ? (id==='amber'?1.21:1.10) : (id==='giant'?1.46:1.32));
      const span=Math.max(nominal,entry.thumbnailRadius+Math.hypot(id==='duel'?.22:0,.04));
      Object.assign(portrait,{left:-span,right:span,top:span,bottom:-span});
      portrait.position.set(-2.2,3.6,12);
      if(turn!==null) portrait.position.applyAxisAngle(up,turn);
      portrait.lookAt(0,id==='duel'?.22:0,0);
      portrait.updateProjectionMatrix();

      const originalTarget=renderer.getRenderTarget();
      studio.add(body);
      try {
        renderer.setRenderTarget(target);
        renderer.render(studio,portrait);
        renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
      } finally {
        renderer.setRenderTarget(originalTarget);
        root.add(body);
      }
      const stride=size*4;
      for(let row=0;row<size;row++) {
        const source=(size-1-row)*stride;
        image.data.set(pixels.subarray(source,source+stride),row*stride);
      }
      ctx.putImageData(image,0,0);
    }

    return {resize,render,launch,focusWorld,preloadWorld,prepareGalleryWorld,warmCoverWorld,showcaseWorld,renderShowcaseDeparture,finishShowcaseTransition,resetZoom,
      resetFocused,back,fromSurface,orbit,scale,canZoomWorld,name,flying,isClose,cancel,atmosphere,hasAnimation,hasRapidMotion,needsFrame,wake,watchArena,arenaShot,drawThumbnail};
  }

  const atlasOrder=['clover','spore','amber','meadow','shore','pond','duel','rose','giant','belt'];
  const worlds=atlasOrder.map(id=>layout.find(entry=>entry.id===id));
  return {create,worlds,worldRadius,fitDistance,frameForAtlas,resizeShadow,worldMinZoom};
})();

;
(() => {
  const surface = document.querySelector('#world');
  const planet = document.querySelector('.planet');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const error = document.querySelector('.error');
  const overview = document.querySelector('#overview');
  const closer = document.querySelector('#closer');
  const farther = document.querySelector('#farther');
  const places = [...document.querySelectorAll('[data-place]')];
  const timeControls = [...document.querySelectorAll('[data-time]')];
  const layoutControls = [...document.querySelectorAll('[data-layout-choice]')];
  const destinations = new Map([...document.querySelectorAll('[data-destination]')].map((button) => [button.dataset.destination,button]));
  const visit = document.querySelector('#visit');
  const stopButtons = [...document.querySelectorAll('[data-stop]')];
  const stopsByRegion = {
    shore:[...Landforms.stops.shore,...Landmarks.stops.shore,ShoreLife.ridgeStop],
    pond:[...Landforms.stops.pond,...Landmarks.stops.pond,PondInsects.stop],
    clover:Clover.stops
  };
  const activity = document.querySelector('#activity');
  const status = document.querySelector('.status');
  const worldTitle = document.querySelector('.title h1');
  const titleFirst = document.querySelector('#title-first');
  const titleLast = document.querySelector('#title-last');
  const cosmicLinks = document.querySelector('.cosmic-links');
  const enterAtlas = document.querySelector('#enter-atlas');
  const atlasHome = document.querySelector('#atlas-home');
  const atlasDemo = document.querySelector('#atlas-demo');
  const atlasToggle = document.querySelector('#open-world-atlas');
  const worldAtlas = document.querySelector('#world-atlas');
  const atlasWorlds = document.querySelector('.world-atlas-worlds');
  const atlasPreview = document.querySelector('.world-atlas-preview');
  const atlasPreviewCanvas = atlasPreview.querySelector('canvas');
  const spaceBack = document.querySelector('.space-back');
  const arenaButtons = [
    ['duel',document.querySelector('#watch-duel'),'Watch the duel'],
    ['yoda',document.querySelector('#watch-yoda'),'Find Yoda'],
    ['penguins',document.querySelector('#watch-penguins'),'Visit the penguins'],
    ['valley',document.querySelector('#watch-valley'),'Explore the valley']
  ];
  const guide = document.querySelector('#orbit-help span:last-child');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactAtlas = matchMedia('(max-width: 740px), (hover: none) and (pointer: coarse)');
  const address = new URLSearchParams(location.search);
  const requestedLayout = address.get('layout');
  const standalone = !['cosmos','one','planets'].includes(requestedLayout);
  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    error.hidden = false;
    enterAtlas.disabled = true;
    document.querySelectorAll('.places, .view-controls, .time-controls, .layout-controls, .guide').forEach((element) => {
      element.style.display = 'none';
    });
    return;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  surface.append(renderer.domElement);

  const scene = new THREE.Scene();
  const atlas = Atlas.create(scene,standalone);
  const cosmos = Cosmos.create(atlas,cosmicLinks,goFromMap,standalone);

  const sky = new THREE.HemisphereLight('#f9ffdb', '#91b6a4', 1.75);
  const sun = new THREE.DirectionalLight('#fff2cd', 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6.3, right: 6.3, top: 6.3, bottom: -6.3, near: .5, far: 29 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .015;
  sun.shadow.bias = -.00017;
  scene.add(sky, sun, sun.target);

  const daylight = {
    ambient: new THREE.Color('#f9ffdb'), bounce: new THREE.Color('#91b6a4'), key: new THREE.Color('#fff2cd')
  };
  const moonlight = {
    ambient: new THREE.Color('#c2d2ff'), bounce: new THREE.Color('#7e9fcc'), key: new THREE.Color('#94baff')
  };
  const blend = THREE.MathUtils.lerp;

  const coverWorld = 'duel';
  const coverSequence = [coverWorld,'rose','spore'];
  const requested = address.get('planet');
  const minSurfaceZoom=standalone?Cosmos.worldMinZoom:0;
  const firstWorld = Cosmos.worlds.find(({id})=>id===requested)?.id ?? coverWorld;
  let layout = standalone ? 'planets' : requestedLayout;
  let fromSpace=standalone;
  let active = !standalone && layout === 'planets' && destinations.has(requested) ? requested : 'meadow';
  let coverOpen = standalone && !requested && !address.has('mode');
  let coverManual = false;
  let coverTime = 0;
  let coverCueTime = 0;
  let coverCueIndex = 0;
  let coverPreloadIndex = -1;
  let coverTransition = null;
  planet.dataset.worldGallery=String(standalone);
  planet.dataset.atlasCover=String(coverOpen);
  const surfaceFov=38;
  const camera = new THREE.PerspectiveCamera(surfaceFov, 1, .10, 265);
  const defaultView = lookFrom(Biomes.view[active].lon, Biomes.view[active].lat);
  const view = defaultView.clone();
  const viewTarget = defaultView.clone();
  const center = new THREE.Vector3();
  const worldCenter = new THREE.Vector3();
  const upright = new THREE.Quaternion();
  const direction = new THREE.Vector3();
  const vertical = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const screenNormal = new THREE.Vector3(0,0,1);
  const spin = new THREE.Quaternion();
  const shotView = new THREE.Quaternion();
  const demoSites = {
    meadow:Land.landmarks.home, shore:Landforms.stops.shore[1], pond:Landforms.stops.pond[0], clover:Clover.stops[0]
  };
  const demoViews = Object.fromEntries(Object.entries(demoSites).map(([id,{lon,lat}])=>[id,{
    view:lookFrom(lon-.12,lat-.18), focus:Land.direction(lon,lat).multiplyScalar(Land.radius*.92)
  }]));
  const demoInterval=90, demoTravel=4, demoHold=15;
  const velocity = new THREE.Vector2();
  const pointers = new Map();
  let pinch = null;
  const frameInterval = 1000 / 30;
  const ambientFrameInterval = 1000 / 15;
  const activityTail = 600;
  const pixelBudget = 1650000;
  let zoom = 0;
  let zoomTarget = 0;
  let viewRoll = 0;
  let overviewDistance = 18.85;
  let lastMove = 0;
  let ambientTime = 0;
  let responsiveUntil = 0;
  let ambientTimer = null;
  let frame = null;
  let lastFrameTime = null;
  let contextLost = false;
  let nightTarget = address.get('mode') === 'night' ? 1 : 0;
  let night = nightTarget;
  let detailed = active;
  let selected = null;
  let flight = null;
  let mapPress = false;
  let mapDragDistance = 0;
  let atlasOpen = false;
  let atlasWarmTimer = null;
  let atlasWarmIdle = null;
  let atlasWarmLeft = 0;
  const atlasFrame = {width:0,height:0,shift:0,span:1,amount:0};
  const worldRadii = new WeakMap();
  const preparedWorlds = new Set();
  let atlasExitTimer = null;
  let atlasPointerMode = false;
  let atlasPointerVisited = false;
  let worldOrbitTime = null;
  let demoPlaying = false;
  let demoTime = 0;
  let demoShot = 0;
  let demoShotHeld = false;
  const touchHintKey = 'atlas-touch-hint-v2';
  let touchHintTimer = null;
  let touchHintSeen = false;
  try { touchHintSeen=localStorage.getItem(touchHintKey)==='seen'; } catch {}
  let previewDelay = null;
  let previewButton = null;
  let hoverFrameTimer = null;
  let hoverStarted = null;
  const surfaceLook = new THREE.Vector3();
  const transitLightView = new THREE.Quaternion();
  const flightDuration = 1560;

  for(const [index,{id,title,tint}] of Cosmos.worlds.entries()) {
    const button=document.createElement('button');
    button.type='button';
    button.dataset.atlasWorld=id;
    button.style.setProperty('--world-tint',tint);
    const picture=document.createElement('span');
    picture.className='world-atlas-picture';
    picture.setAttribute('aria-hidden','true');
    picture.style.setProperty('--world-thumbnail-position',`${100*index/(Cosmos.worlds.length-1)}%`);
    const label=document.createElement('span');
    label.textContent=title;
    button.append(picture,label);
    button.addEventListener('pointermove',event=>{
      if(event.pointerType==='mouse' || event.pointerType==='pen') setAtlasPreview(button);
    });
    button.addEventListener('pointerleave',()=>{
      if(previewButton===button && !button.matches(':focus-visible')) setAtlasPreview(null);
    });
    button.addEventListener('focus',()=>{
      if(button.matches(':focus-visible')) setAtlasPreview(button);
    });
    button.addEventListener('blur',()=>{
      if(previewButton===button && !button.matches(':hover')) setAtlasPreview(null);
    });
    button.addEventListener('click',()=>standalone?selectWorld(id):goFromMap(id));
    atlasWorlds.append(button);
  }

  function cancelAtlasWarmup() {
    clearTimeout(atlasWarmTimer);
    atlasWarmTimer=null;
    if(atlasWarmIdle!==null) cancelIdleCallback(atlasWarmIdle);
    atlasWarmIdle=null;
  }

  function queueAtlasWarmup() {
    cancelAtlasWarmup();
    if(!standalone || !atlasOpen || !atlasWarmLeft || contextLost || document.hidden) return;
    atlasWarmTimer=setTimeout(()=>{
      atlasWarmTimer=null;
      if(typeof requestIdleCallback==='function') atlasWarmIdle=requestIdleCallback(prepareVisibleAtlasWorld);
      else prepareVisibleAtlasWorld();
    },420);
  }

  function prepareVisibleAtlasWorld(deadline) {
    atlasWarmIdle=null;
    if(!atlasOpen || contextLost || document.hidden) return;
    if(deadline && deadline.timeRemaining()<8) {
      queueAtlasWarmup();
      return;
    }
    const strip=atlasWorlds.getBoundingClientRect();
    const card=Array.from(atlasWorlds.children).find(button=>{
      if(preparedWorlds.has(button.dataset.atlasWorld)) return false;
      const {left,right,width}=button.getBoundingClientRect();
      return Math.min(strip.right,right)-Math.max(strip.left,left)>width*.5;
    });
    if(!card) return;
    const id=card.dataset.atlasWorld;
    if(atlas.bodies.has(id)) {
      atlas.getModel(id);
      const {root}=atlas.bodies.get(id);
      if(!compactAtlas.matches) worldRadii.set(root,Cosmos.worldRadius(root));
    } else cosmos.prepareGalleryWorld(id,!compactAtlas.matches);
    preparedWorlds.add(id);
    atlasWarmLeft--;
    queueAtlasWarmup();
  }

  function positionAtlasPreview() {
    const card=previewButton.getBoundingClientRect();
    const shelf=worldAtlas.getBoundingClientRect();
    const strip=atlasWorlds.getBoundingClientRect();
    if(card.right<=strip.left || card.left>=strip.right) return false;
    const half=atlasPreview.offsetWidth/2+8;
    const center=THREE.MathUtils.clamp(card.left-shelf.left+card.width/2,half,shelf.width-half);
    atlasPreview.style.setProperty('--preview-x',`${center}px`);
    return true;
  }

  function drawAtlasPreview() {
    hoverFrameTimer=null;
    if(!atlasOpen || !previewButton || previewDelay!==null || contextLost || document.hidden) return;
    if(!positionAtlasPreview()) {
      setAtlasPreview(null);
      return;
    }
    const now=performance.now();
    hoverStarted??=now;
    const still=reducedMotion.matches;
    cosmos.drawThumbnail(renderer,previewButton.dataset.atlasWorld,atlasPreviewCanvas,still?0:(now-hoverStarted)*.00032);
    atlasPreview.dataset.visible='true';
    if(!still) hoverFrameTimer=setTimeout(drawAtlasPreview,55);
  }

  function setAtlasPreview(button) {
    if(compactAtlas.matches) button=null;
    if(previewButton===button) return;
    clearTimeout(hoverFrameTimer);
    hoverFrameTimer=null;
    hoverStarted=null;
    previewButton=button;
    atlasPreview.dataset.visible='false';
    if(!button) return;
    const world=Cosmos.worlds.find(({id})=>id===button.dataset.atlasWorld);
    atlasPreview.style.setProperty('--world-tint',world.tint);
    hoverFrameTimer=setTimeout(drawAtlasPreview,100);
  }

  function cancelAtlasExit() {
    clearTimeout(atlasExitTimer);
    atlasExitTimer=null;
  }

  function scheduleAtlasExit() {
    if(atlasExitTimer===null) atlasExitTimer=setTimeout(()=>setAtlasOpen(false),180);
  }

  function clearTouchHint() {
    clearTimeout(touchHintTimer);
    touchHintTimer=null;
    planet.dataset.touchHint='false';
  }

  function finishTouchHint() {
    if(touchHintTimer===null) return;
    clearTouchHint();
    touchHintSeen=true;
    try { localStorage.setItem(touchHintKey,'seen'); } catch {}
  }

  function maybeShowTouchHint() {
    if(!standalone || !compactAtlas.matches || coverOpen || atlasOpen || touchHintSeen || touchHintTimer!==null) return;
    planet.dataset.touchHint='true';
    touchHintTimer=setTimeout(finishTouchHint,8500);
  }

  function markAtlasWorld(id) {
    let currentCard;
    for(const card of atlasWorlds.children) {
      if(card.dataset.atlasWorld===id) {
        currentCard=card;
        card.setAttribute('aria-current','true');
      } else card.removeAttribute('aria-current');
    }
    return currentCard;
  }

  function setAtlasOpen(open,restoreFocus=false,focusPanel=true) {
    cancelAtlasExit();
    if(atlasOpen===open) return;
    atlasOpen=open;
    planet.dataset.atlasOpen=String(open);
    atlasToggle.setAttribute('aria-expanded',String(open));
    worldAtlas.setAttribute('aria-hidden',String(!open));
    worldAtlas.inert=!open;
    if(open) {
      clearTouchHint();
      clearCameraMotion();
      measureAtlasFrame();
      const current=layout==='cosmos' ? cosmos.atmosphere().name : active;
      const currentCard=markAtlasWorld(current);
      if(focusPanel) (currentCard ?? atlasWorlds.firstElementChild).focus({preventScroll:true});
      atlasWarmLeft=2;
      queueAtlasWarmup();
      if(!reducedMotion.matches && !compactAtlas.matches) previewDelay=setTimeout(()=>{
        previewDelay=null;
        if(previewButton && hoverFrameTimer===null) drawAtlasPreview();
      },590);
    } else {
      atlasPointerMode=false;
      atlasPointerVisited=false;
      cancelAtlasWarmup();
      setAtlasPreview(null);
      if(previewDelay!==null) {
        clearTimeout(previewDelay);
        previewDelay=null;
      }
      if(restoreFocus) atlasToggle.focus({preventScroll:true});
      maybeShowTouchHint();
    }
    requestRender(true);
  }

  function cancelAmbientFrame() {
    if (ambientTimer === null) return;
    clearTimeout(ambientTimer);
    ambientTimer = null;
  }

  function requestRender(interacting = false) {
    if (document.hidden || contextLost) return;
    if (interacting && !reducedMotion.matches) responsiveUntil = performance.now() + activityTail;
    cancelAmbientFrame();
    if (frame === null) frame = requestAnimationFrame(render);
  }

  function scheduleAmbientFrame(now) {
    const delay = Math.max(0, now + ambientFrameInterval - performance.now() - 8);
    ambientTimer = setTimeout(() => {
      ambientTimer = null;
      requestRender();
    }, delay);
  }

  function pauseScene() {
    cancelAtlasWarmup();
    setAtlasPreview(null);
    cancelAmbientFrame();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastFrameTime = null;
    responsiveUntil = 0;
    clearCameraMotion();
    cosmos.wake();
  }

  function populateStars() {
    const stars = document.querySelector('.stars');
    const random = Land.rng(83101);
    const items = document.createDocumentFragment();
    for (let i = 0; i < 91; i++) {
      const star = document.createElement('i');
      star.style.left = (2 + 96 * random()) + '%';
      star.style.top = (2 + 92 * random()) + '%';
      star.style.setProperty('--size', (.7 + random() ** 2 * 2.0) + 'px');
      star.style.setProperty('--alpha', (.21 + random() * .70).toFixed(2));
      items.append(star);
    }
    document.querySelector('.space-stars').append(items.cloneNode(true));
    stars.append(items);
  }

  function syncBrowserBackground() {
    const color = getComputedStyle(planet).getPropertyValue('--browser-background').trim() || '#172033';
    document.documentElement.style.backgroundColor = color;
    themeColor.content = color;
  }

  function setTime(mode, updateUrl = false) {
    nightTarget = mode === 'night' ? 1 : 0;
    planet.dataset.time = mode;
    syncBrowserBackground();
    for (const button of timeControls) button.setAttribute('aria-pressed', String(button.dataset.time === mode));
    if (updateUrl && location.protocol !== 'file:') {
      const address = new URL(location.href);
      if (nightTarget) address.searchParams.set('mode', 'night');
      else address.searchParams.delete('mode');
      history.replaceState(null, '', address);
    }
    requestRender(updateUrl);
  }

  function lookFrom(lon, lat) {
    const matrix = new THREE.Matrix4().lookAt(Land.direction(lon,lat), new THREE.Vector3(), new THREE.Vector3(0,1,0));
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
  }

  function measureAtlasFrame(width=surface.clientWidth,height=surface.clientHeight) {
    if(!standalone || coverOpen || compactAtlas.matches || !width || !height) return;
    const margin=Math.min(28,height*.042);
    const bottom=Math.max(2*margin+1,worldAtlas.offsetTop);
    atlasFrame.width=width;
    atlasFrame.height=height;
    atlasFrame.shift=(height-bottom)/2;
    atlasFrame.span=.96*(Math.min(width,bottom)-2*margin)/height;
  }

  function resize() {
    const width = surface.clientWidth;
    const height = surface.clientHeight;
    if (!width || !height) return;
    const renderWidth = coverOpen ? renderer.domElement.clientWidth || width : width;
    const renderHeight = coverOpen ? renderer.domElement.clientHeight || height : height;
    let renderFrame;
    if(coverOpen) {
      if(coverTransition) {
        coverCueTime=coverTime;
        clearCoverTransition();
      }
      const slot=surface.getBoundingClientRect();
      const canvas=renderer.domElement.getBoundingClientRect();
      renderFrame={x:canvas.left-slot.left,y:canvas.top-slot.top,width:renderWidth,height:renderHeight};
    }
    camera.aspect = width / height;
    const compact=compactAtlas.matches;
    const shadowSize=compact?768:1024;
    Cosmos.resizeShadow(sun,shadowSize);
    cosmos.resize(width,height,renderFrame,shadowSize);
    measureAtlasFrame(width,height);
    overviewDistance = Math.max(18.85, 16.15 / camera.aspect);
    camera.updateProjectionMatrix();
    const ratio = Math.min(devicePixelRatio, 1.25, Math.sqrt(pixelBudget / (renderWidth * renderHeight)));
    renderer.setDrawingBufferSize(renderWidth, renderHeight, ratio);
    requestRender();
  }

  function syncZoomControls() {
    const onMap=layout==='cosmos';
    closer.disabled=onMap?standalone && !cosmos.canZoomWorld(1):zoomTarget>=.999;
    farther.disabled=onMap?standalone && !cosmos.canZoomWorld(-1):
      (standalone || !fromSpace) && zoomTarget<=minSurfaceZoom+.001;
    planet.classList.toggle('is-close', !onMap && zoomTarget>.39);
  }

  function setZoom(value, interacting = true) {
    zoomTarget = THREE.MathUtils.clamp(value, minSurfaceZoom, 1);
    syncZoomControls();
    requestRender(interacting);
  }

  function syncLabels() {
    const region = Atlas.regions[active];
    const onMap=layout==='cosmos';
    const moving=onMap?cosmos.flying():Boolean(flight);
    const browsing=onMap && !moving && !cosmos.isClose();
    const title = onMap ? cosmos.name() ?? 'Space' : region.title.join(' ');
    worldTitle.setAttribute('aria-label', title);
    titleFirst.textContent = onMap || standalone ? title : region.title[0];
    titleLast.textContent = onMap || standalone ? '' : (region.title[1] ?? '');
    planet.dataset.layout = layout;
    planet.dataset.region = onMap?'cosmos':active;
    planet.dataset.space = onMap?'atlas':'local';
    planet.dataset.flying = String(moving);
    planet.dataset.mapView = String(browsing);
    syncBrowserBackground();
    syncZoomControls();
    atlasToggle.hidden=!standalone && !browsing;
    if(!standalone && !browsing) setAtlasOpen(false);
    cosmicLinks.hidden=standalone || !onMap;
    spaceBack.hidden=standalone || moving || !(fromSpace || (onMap && cosmos.isClose()));
    const arena=cosmos.arenaShot();
    const showArena=!standalone && onMap && !moving && cosmos.isClose() && cosmos.atmosphere().name==='duel';
    for(const [id,button,label] of arenaButtons) {
      button.hidden=!showArena || Boolean(arena && arena!==id);
      button.textContent=arena===id?'Whole world':label;
    }
    timeControls[0].parentElement.hidden=!standalone && onMap;
    guide.textContent=standalone && compactAtlas.matches && !coverOpen ? 'Drag or twist to rotate · Pinch to zoom'
      : onMap && !cosmos.isClose() ? 'Drag to look around'
      : !standalone && (fromSpace || onMap) ? 'Drag to rotate · Zoom out to return to the map' : 'Drag to rotate';
    for (const button of layoutControls) button.setAttribute('aria-pressed', String(button.dataset.layoutChoice === layout));
    for (const [name,button] of destinations) button.hidden = layout !== 'planets' || fromSpace || name === active || Boolean(flight);
    visit.textContent = region.visit;
    const stops = stopsByRegion[active] || [];
    for (const [i,button] of stopButtons.entries()) {
      button.hidden = !stops[i];
      if (stops[i]) button.textContent = stops[i].label;
    }
    visit.parentElement.hidden = standalone || layout !== 'planets' || Boolean(selected) || Boolean(flight);
    activity.parentElement.hidden = standalone || onMap || !selected || Boolean(flight);
    if (selected) activity.textContent = Atlas.regions[selected].act;
  }

  function selectPlace(place) {
    if (place === selected) return;
    selected = place;
    for (const button of places) button.setAttribute('aria-pressed', String(button.dataset.place === place));
    syncLabels();
  }

  function resetView() {
    setDemoPlaying(false,true);
    if(layout==='cosmos') {
      if(standalone) {
        clearCameraMotion();
        cosmos.resetFocused();
        syncZoomControls();
        requestRender(true);
      } else if(cosmos.arenaShot()) toggleArena();
      else changeLayout('cosmos');
      return;
    }
    viewTarget.copy(defaultView);
    viewRoll = 0;
    velocity.set(0,0);
    selectPlace(null);
    setZoom(0);
  }

  function moveTo(place) {
    const { lon, lat } = (layout === 'one' ? Land.districts : Biomes.places)[place];
    const latitudeOffset = place === 'pond' ? .13 : .19;
    viewTarget.copy(lookFrom(lon - .025, lat - latitudeOffset));
    velocity.set(0,0);
    selectPlace(place);
    const close = ({shore:.67,pond:.64,clover:.58})[place] ?? .77;
    const framing = layout === 'planets' && place === 'shore' ? .54 : close;
    setZoom(camera.aspect < .65 ? framing - .06 : framing);
  }

  function viewStop(index) {
    const stop = stopsByRegion[active]?.[index];
    if (!stop) return;
    viewTarget.copy(lookFrom(stop.lon-.03,stop.lat-(stop.tilt ?? .13)));
    velocity.set(0,0);
    selectPlace(null);
    setZoom(camera.aspect < .65 ? stop.zoom-.05 : stop.zoom);
    status.textContent = stop.label;
  }

  function showDetailed(name) {
    detailed = name;
    atlas.show(detailed,layout === 'one',fromSpace);
  }

  function arrive(name) {
    flight = null;
    if (camera.fov!==surfaceFov) {
      camera.fov=surfaceFov;
      camera.updateProjectionMatrix();
    }
    active = name;
    const arrival = atlas.bodies.get(active).root;
    arrival.position.set(0,0,0);
    arrival.quaternion.identity();
    worldCenter.set(0,0,0);
    const {lon,lat} = Biomes.view[active];
    defaultView.copy(lookFrom(lon,lat));
    view.copy(defaultView);
    viewTarget.copy(defaultView);
    viewRoll = 0;
    zoom = 0;
    velocity.set(0,0);
    showDetailed(active);
    selectPlace(null);
    setZoom(0);
    syncLabels();
  }

  function changeLayout(choice) {
    if(choice==='cosmos') {
      if(layout==='cosmos') cosmos.back(performance.now(),reducedMotion.matches);
      else {
        const wasNear=fromSpace;
        flight=null;
        selected=null;
        layout='cosmos';
        clearCameraMotion();
        if(wasNear) cosmos.fromSurface(active,camera,surfaceLook,performance.now(),reducedMotion.matches);
        else cosmos.back(performance.now(),reducedMotion.matches);
      }
      fromSpace=false;
      setZoom(0,false);
      status.textContent='';
      syncLabels();
      requestRender(true);
      return;
    }
    if (choice === layout && !fromSpace) return;
    if(layout==='cosmos') cosmos.cancel();
    layout = choice;
    fromSpace=false;
    arrive('meadow');
    const labels = {one:'One World',planets:'Four Worlds'};
    status.textContent = labels[choice];
  }

  function clearCameraMotion() {
    velocity.set(0,0);
    pointers.clear();
    pinch = null;
    surface.classList.remove('dragging');
  }

  function selectWorld(id,startup=false) {
    preparedWorlds.add(id);
    queueAtlasWarmup();
    clearCameraMotion();
    worldOrbitTime=standalone && !coverOpen?0:null;
    demoTime=demoShot=0;
    demoShotHeld=false;
    if(!startup) {
      atlasPointerMode=false;
      cancelAtlasExit();
      markAtlasWorld(id);
    }
    if(atlas.bodies.has(id)) {
      cosmos.cancel();
      layout='planets';
      fromSpace=true;
      arrive(id);
    } else {
      layout='cosmos';
      fromSpace=false;
      cosmos.focusWorld(id,coverOpen);
      syncLabels();
      requestRender(true);
    }
    if(!startup) status.textContent=Cosmos.worlds.find(world=>world.id===id).title;
  }

  function goFromMap(name) {
    if(layout!=='cosmos' || cosmos.flying() || cosmos.isClose()) return;
    clearCameraMotion();
    if(atlasOpen) surface.focus({preventScroll:true});
    setAtlasOpen(false);
    cosmos.launch(name,performance.now(),reducedMotion.matches);
    syncLabels();
    const destination=cosmos.name();
    status.textContent=destination ? `Flying to ${destination}` : '';
    requestRender(true);
  }

  function travelTo(place) {
    if (flight || active === place || layout !== 'planets') return;
    if (reducedMotion.matches) {
      arrive(place);
      status.textContent = Atlas.regions[place].title.join(' ');
      return;
    }
    const {lon,lat} = Biomes.view[place];
    const destination = atlas.bodies.get(place).root;
    flight = {
      name: place, start: performance.now(), offset: destination.position.clone(),
      orientation: destination.quaternion.clone(), from: view.clone(), to: lookFrom(lon,lat), zoom
    };
    atlas.show(active,false);
    velocity.set(0,0);
    selectPlace(null);
    syncLabels();
    status.textContent = 'Flying to ' + Atlas.regions[place].title.join(' ');
    requestRender(true);
  }

  function advanceFlight(now) {
    const progress = THREE.MathUtils.clamp((now-flight.start)/flightDuration,0,1);
    if (progress === 1 || reducedMotion.matches) {
      const name = flight.name;
      arrive(name);
      status.textContent = Atlas.regions[name].title.join(' ');
      return 0;
    }
    const ease = THREE.MathUtils.smootherstep(progress,0,1);
    worldCenter.copy(flight.offset).multiplyScalar(ease);
    atlas.bodies.get(flight.name).root.quaternion.copy(flight.orientation)
      .slerp(upright,THREE.MathUtils.smoothstep(progress,.17,.87));
    view.copy(flight.from).slerp(flight.to,THREE.MathUtils.smoothstep(progress,.13,.93));
    viewTarget.copy(view);
    zoom = blend(flight.zoom,0,THREE.MathUtils.smoothstep(progress,0,.42));
    if (progress >= .53 && detailed !== flight.name) showDetailed(flight.name);
    return Math.sin(progress*Math.PI)*3.4;
  }

  function orbit(dx, dy, roll = 0) {
    if(layout==='cosmos') {
      if(coverOpen && !coverManual) {
        coverManual=true;
        clearCoverTransition();
      }
      if(cosmos.orbit(dx,dy,roll)) syncLabels();
      return;
    }
    if (roll) {
      viewRoll += roll;
      return;
    }
    const length = Math.hypot(dx, dy);
    if (!length) return;
    axis.set(-dy / length, -dx / length, 0);
    if (viewRoll) axis.applyAxisAngle(screenNormal,viewRoll);
    spin.setFromAxisAngle(axis, Math.min(length * .006, Math.PI));
    view.multiply(spin).normalize();
    viewTarget.copy(view);
  }

  function readPinch() {
    const [one, two] = pointers.values();
    return {x:two.x-one.x,y:two.y-one.y,twist:one.touch && two.touch};
  }

  function updatePinch() {
    if (!pinch || pointers.size !== 2 || flight || (layout==='cosmos' && cosmos.flying())) return;
    const previous = pinch;
    pinch = readPinch();
    const before = Math.hypot(previous.x,previous.y);
    const after = Math.hypot(pinch.x,pinch.y);
    if (pinch.twist && before > 18 && after > 18) {
      // Compare the two finger positions together so event order doesn't affect the gesture.
      const cross = previous.x*pinch.y - previous.y*pinch.x;
      const dot = previous.x*pinch.x + previous.y*pinch.y;
      const rotation = Math.atan2(cross,dot);
      if (rotation) orbit(0,0,rotation);
    }
    if (before > 5 && after > 5) {
      const adjustment = Math.log(after/before) * .55;
      if (Math.abs(adjustment) > .0001) applyZoom(adjustment);
    }
  }

  function pointerDown(event) {
    if (flight) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (pointers.size === 2) return;
    if (!pointers.size) {
      mapPress = cosmicLinks.contains(event.target);
      mapDragDistance = 0;
      if(!coverOpen && !atlasOpen) setDemoPlaying(false);
    }
    const receiver = event.target.closest('[data-cosmic-target]') || surface;
    receiver.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, touch: event.pointerType==='touch' });
    if (pointers.size === 2) pinch = readPinch();
    velocity.set(0,0);
    viewTarget.copy(view);
    lastMove = event.timeStamp;
    surface.classList.add('dragging');
    requestRender(true);
  }

  function pointerMove(event) {
    if (flight) return;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const isPinch = pointers.size === 2;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    if (!dx && !dy) return;
    previous.x = event.clientX;
    previous.y = event.clientY;
    mapDragDistance += Math.hypot(dx,dy);
    if(layout==='cosmos' && cosmos.flying()) {
      lastMove=event.timeStamp;
      return;
    }
    if (mapPress) {
      if (mapDragDistance < 5 && !isPinch) return;
      if(!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId);
    }
    if(!coverOpen) setDemoPlaying(false,true);
    selectPlace(null);
    if (!isPinch) {
      const elapsed = Math.max(8, event.timeStamp - lastMove) / 1000;
      orbit(dx,dy);
      velocity.set(dx / elapsed, dy / elapsed).clampLength(0, 1000);
    }
    requestRender(true);
    lastMove = event.timeStamp;
  }

  function pointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    if(event.type==='lostpointercapture' && surface.hasPointerCapture(event.pointerId)) return;
    if (pinch && event.type==='pointerup') updatePinch();
    pinch = null;
    if (pointers.size > 1 || event.type !== 'pointerup' || event.timeStamp - lastMove > 85) velocity.set(0,0);
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      surface.classList.remove('dragging');
      requestRender();
    }
  }

  function applyZoom(adjustment) {
    if(coverOpen) return;
    setDemoPlaying(false,true);
    finishTouchHint();
    if(layout==='cosmos') {
      const wasFlying=cosmos.flying(), wasDuelShot=cosmos.arenaShot();
      cosmos.scale(adjustment,performance.now(),reducedMotion.matches,standalone);
      if ((!wasFlying && cosmos.flying()) || wasDuelShot!==cosmos.arenaShot()) syncLabels();
      else syncZoomControls();
      requestRender(true);
    } else if (!standalone && fromSpace && adjustment < 0 && zoomTarget <= .001) {
      changeLayout('cosmos');
    } else {
      selectPlace(null);
      setZoom(zoomTarget+adjustment);
    }
  }

  for (const area of [surface,cosmicLinks]) {
    area.addEventListener('pointerdown', pointerDown);
    area.addEventListener('pointermove', pointerMove);
    area.addEventListener('pointerup', pointerEnd);
    area.addEventListener('pointercancel', pointerEnd);
    area.addEventListener('lostpointercapture', pointerEnd);
    area.addEventListener('wheel',wheel,{passive:false});
  }
  cosmicLinks.addEventListener('click', (event) => {
    if (event.detail && mapPress && mapDragDistance >= 5) event.stopImmediatePropagation();
    mapDragDistance=0;
  },true);

  function wheel(event) {
    if(coverOpen) return;
    event.preventDefault();
    if (flight) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1;
    const adjustment = THREE.MathUtils.clamp(-event.deltaY * units * .0019, -.27, .27);
    applyZoom(adjustment);
  }
  surface.addEventListener('keydown', (event) => {
    if (flight) return;
    const offsets = { ArrowUp: [0,-25], ArrowDown: [0,25], ArrowLeft: [-25,0], ArrowRight: [25,0] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    setDemoPlaying(false,true);
    velocity.set(0,0);
    selectPlace(null);
    orbit(...offset);
    requestRender(true);
  });
  overview.addEventListener('click', resetView);
  closer.addEventListener('click', () => applyZoom(.20));
  farther.addEventListener('click', () => applyZoom(-.20));
  function toggleArena(id) {
    velocity.set(0,0);
    cosmos.watchArena(id);
    syncLabels();
    requestRender(true);
  }
  for(const [id,button] of arenaButtons) button.addEventListener('click',()=>toggleArena(id));
  spaceBack.addEventListener('click',()=>changeLayout('cosmos'));
  enterAtlas.addEventListener('click',event=>{
    clearCoverTransition();
    coverOpen=false;
    worldOrbitTime=0;
    planet.dataset.atlasCover='false';
    syncLabels();
    resize();
    maybeShowTouchHint();
    if(event.detail===0) atlasToggle.focus({preventScroll:true});
  });
  atlasDemo.addEventListener('click',()=>setDemoPlaying(!demoPlaying));
  atlasHome.addEventListener('click',()=>{
    coverOpen=true;
    setDemoPlaying(false,true);
    setAtlasOpen(false);
    clearTouchHint();
    coverManual=false;
    coverTime=0;
    coverCueTime=0;
    coverCueIndex=0;
    coverPreloadIndex=-1;
    clearCoverTransition();
    planet.dataset.atlasCover='true';
    if(location.protocol!=='file:') {
      const home=new URL(location.href);
      home.searchParams.delete('planet');
      home.searchParams.delete('mode');
      history.replaceState(null,'',home);
    }
    selectWorld(coverWorld,true);
    setTime('day');
    status.textContent='';
    resize();
    enterAtlas.focus({preventScroll:true});
  });
  const isAtlasPointer=event=>!compactAtlas.matches && (event.pointerType==='mouse' || event.pointerType==='pen');
  compactAtlas.addEventListener('change',()=>{
    cancelAtlasExit();
    atlasPointerMode=false;
    atlasPointerVisited=false;
    if(compactAtlas.matches) {
      atlasFrame.amount=0;
      setAtlasPreview(null);
      maybeShowTouchHint();
    } else {
      clearTouchHint();
      measureAtlasFrame();
    }
    syncLabels();
    resize();
    requestRender(true);
  });
  atlasToggle.addEventListener('pointermove',event=>{
    if(!isAtlasPointer(event)) return;
    atlasPointerMode=true;
    setAtlasOpen(true,false,false);
  });
  atlasToggle.addEventListener('click',event=>{
    atlasPointerMode=false;
    if(isAtlasPointer(event)) atlasPointerVisited=true;
    setAtlasOpen(true,false,event.detail===0);
  });
  atlasWorlds.addEventListener('scroll',queueAtlasWarmup,{passive:true});
  atlasWorlds.addEventListener('pointerdown',cancelAtlasWarmup,{passive:true});
  atlasWorlds.addEventListener('pointercancel',queueAtlasWarmup,{passive:true});
  planet.addEventListener('pointermove',event=>{
    if(!atlasOpen || !isAtlasPointer(event)) return;
    const {left,right}=worldAtlas.getBoundingClientRect();
    const top=planet.getBoundingClientRect().top + worldAtlas.offsetTop;
    const inside=event.clientX>=left-5 && event.clientX<=right+5 &&
      event.clientY>=top-5 && event.clientY<=top+worldAtlas.offsetHeight+5;
    if(inside) {
      atlasPointerVisited=true;
      cancelAtlasExit();
    } else if(atlasPointerMode || atlasPointerVisited) scheduleAtlasExit();
  });
  planet.addEventListener('pointerleave',event=>{
    if(atlasOpen && (atlasPointerMode || atlasPointerVisited) && isAtlasPointer(event)) scheduleAtlasExit();
  });
  surface.addEventListener('click',event=>{
    if(atlasOpen && (!event.detail || mapDragDistance<5)) setAtlasOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && atlasOpen) setAtlasOpen(false,true);
  });
  atlasWorlds.addEventListener('wheel',event=>{
    if(event.ctrlKey || event.metaKey || Math.abs(event.deltaY)<=Math.abs(event.deltaX) ||
      atlasWorlds.scrollWidth<=atlasWorlds.clientWidth) return;
    event.preventDefault();
    atlasWorlds.scrollLeft+=event.deltaY*(event.deltaMode===1?18:1);
  },{passive:false});
  for (const button of places) button.addEventListener('click', () => moveTo(button.dataset.place));
  for (const button of timeControls) button.addEventListener('click', () => setTime(button.dataset.time, true));
  for (const button of layoutControls) button.addEventListener('click', () => changeLayout(button.dataset.layoutChoice));
  for (const [place,button] of destinations) button.addEventListener('click', () => travelTo(place));
  visit.addEventListener('click', () => moveTo(active));
  stopButtons.forEach((button,index) => button.addEventListener('click', () => viewStop(index)));
  activity.addEventListener('click', () => {
    if (!selected) return;
    atlas.act(active, selected, ambientTime - (reducedMotion.matches ? .24 : 0));
    status.textContent = Atlas.regions[selected].response;
    requestRender(true);
  });
  const viewSize = new ResizeObserver(resize);
  viewSize.observe(surface);
  viewSize.observe(planet);
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    delete planet.dataset.coverReady;
    pauseScene();
    error.hidden = false;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    error.hidden = true;
    contextLost = false;
    queueAtlasWarmup();
    requestRender();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseScene();
    else {
      queueAtlasWarmup();
      requestRender();
    }
  });
  reducedMotion.addEventListener('change', () => {
    responsiveUntil = 0;
    velocity.set(0, 0);
    if(reducedMotion.matches) clearCoverTransition();
    requestRender();
  });

  function drawWorld(seconds,lightView,lightCenter) {
    const still=reducedMotion.matches;
    sky.color.copy(daylight.ambient).lerp(moonlight.ambient, night);
    sky.groundColor.copy(daylight.bounce).lerp(moonlight.bounce, night);
    sky.intensity = blend(1.75, .94, night);
    sun.color.copy(daylight.key).lerp(moonlight.key, night);
    sun.intensity = blend(2.35, 1.62, night);
    sun.target.position.copy(lightCenter);
    sun.position.set(blend(-5.6, 8.4, night), blend(8.5, 9.5, night), blend(10.2, 6.3, night)).applyQuaternion(lightView).add(lightCenter);
    if (!still) ambientTime += Math.min(.15, seconds);
    if(detailed==='meadow') {
      const {water}=atlas;
      water.origin.value.copy(atlas.bodies.get('meadow').root.position);
      water.moon.value=sun.position;
    }
    atlas.animate(detailed,ambientTime,night,renderer.getPixelRatio());

    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }

  function drawTransitSurface(pose,seconds) {
    if (detailed!==pose.id || !atlas.bodies.get(pose.id).root.visible) {
      atlas.show(pose.id,false,true);
      detailed=pose.id;
    }
    for (const [id,body] of atlas.bodies) body.root.visible=id===detailed;
    const body=atlas.bodies.get(detailed).root;
    body.position.set(0,0,0);
    body.quaternion.identity();
    camera.position.copy(pose.eye);
    camera.up.copy(pose.up);
    camera.fov=pose.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(pose.look);
    transitLightView.copy(camera.quaternion);
    night=nightTarget;
    drawWorld(seconds,transitLightView,body.position);
  }

  function clearCoverTransition() {
    coverTransition=null;
    cosmos.finishShowcaseTransition();
    planet.dataset.coverTransition='false';
  }

  function positionCoverTransition(amount) {
    const {rightEdge,rise,departure,incoming,outgoing}=coverTransition;
    const remaining=1-amount;
    incoming.x=rightEdge*(remaining**2+.78*remaining*amount);
    incoming.y=-rise*(remaining**2+.45*remaining*amount);
    incoming.angle=THREE.MathUtils.degToRad(11*remaining);
    outgoing.x=rightEdge*(1.36*amount-.36*amount**2);
    outgoing.y=departure*(.15*amount+.85*amount**2);
    outgoing.angle=THREE.MathUtils.degToRad(-16*amount);
  }

  function startCoverTransition() {
    const slot=surface.getBoundingClientRect();
    const canvas=renderer.domElement.getBoundingClientRect();
    const width=renderer.domElement.clientWidth || planet.clientWidth;
    const height=renderer.domElement.clientHeight || planet.clientHeight;
    const side=surface.clientWidth*.18;
    coverTransition={
      start:coverTime,width,height,pivotX:2*(slot.left-canvas.left+surface.clientWidth/2)/width-1,
      pivotY:1-2*(slot.top-canvas.top+surface.clientHeight/2)/height,
      rightEdge:planet.clientWidth-slot.left+side,rise:surface.clientHeight*.34,
      departure:planet.clientHeight-slot.top+side,incoming:{},outgoing:{}
    };
    positionCoverTransition(0);
    planet.dataset.coverTransition='true';
    coverCueIndex=(coverCueIndex+1)%coverSequence.length;
    cosmos.showcaseWorld(coverSequence[coverCueIndex]);
    syncLabels();
  }

  function preloadNextCoverWorld() {
    const index=coverCueIndex;
    coverPreloadIndex=index;
    const next=coverSequence[(index+1)%coverSequence.length];
    const load=()=>{
      if(coverOpen && coverCueIndex===index && !coverManual && !contextLost && !document.hidden && !reducedMotion.matches) {
        cosmos.preloadWorld(next,renderer);
      } else if(coverCueIndex===index) coverPreloadIndex=-1;
    };
    if(typeof requestIdleCallback==='function') requestIdleCallback(load,{timeout:1500});
    else setTimeout(load,400);
  }

  function animateCover(elapsed) {
    const seconds=Math.min(elapsed/1000,.065);
    coverTime+=seconds;
    let sweep=0;
    if(coverTransition) {
      const progress=Math.min(1,(coverTime-coverTransition.start)/1.9);
      const launch=progress*(2-progress);
      positionCoverTransition(blend(THREE.MathUtils.smootherstep(progress,0,1),launch,.14));
      sweep=20*Math.sin(progress*Math.PI*2);
      if(progress===1) {
        coverCueTime=coverTime;
        clearCoverTransition();
      }
    } else if(coverTime-coverCueTime>=5) startCoverTransition();
    else if(coverTime-coverCueTime>.45 && coverPreloadIndex!==coverCueIndex) preloadNextCoverWorld();
    const tilt=coverTime*.087;
    cosmos.orbit(seconds*(12*Math.cos(tilt)+sweep),0);
  }

  function animateOpenedWorld(elapsed) {
    if(worldOrbitTime===null || (atlasOpen && atlasPointerMode) || pointers.size || reducedMotion.matches) return false;
    const seconds=Math.min(elapsed/1000,.10);
    worldOrbitTime+=seconds;
    const activeFor=3.8;
    const phase=(worldOrbitTime-1.15)%9.4;
    if(phase<=0 || phase>=activeFor) return false;
    const speed=20*Math.sin(Math.PI*phase/activeFor)**2;
    orbit(speed*seconds,speed*seconds*.32*Math.cos(worldOrbitTime*.54));
    return true;
  }

  function setDemoPlaying(playing,releaseShot=false) {
    worldOrbitTime=null;
    if(releaseShot) demoShotHeld=false;
    if(demoPlaying===playing) return;
    demoPlaying=playing;
    demoShotHeld=!playing && !releaseShot && demoShot>0;
    demoTime=0;
    atlasDemo.setAttribute('aria-pressed',String(playing));
    if(playing) {
      clearCameraMotion();
      if(layout==='cosmos') {
        cosmos.resetZoom();
        syncZoomControls();
      }
      else setZoom(0,false);
    }
    requestRender(true);
  }

  function animateDemo(elapsed,now) {
    if(!demoPlaying && (!demoShot || demoShotHeld)) return false;
    const seconds=Math.min(elapsed/1000,.10);
    let shot=0;
    if(demoPlaying && !atlasOpen && !pointers.size) {
      demoTime+=seconds;
      const phase=demoTime<demoInterval?-1:(demoTime-demoInterval)%demoInterval;
      const {smootherstep}=THREE.MathUtils;
      shot=smootherstep(phase,0,demoTravel)*(1-smootherstep(phase,demoTravel+demoHold,2*demoTravel+demoHold));
    }
    demoShot=blend(demoShot,shot,1-Math.exp(-9*seconds));
    if(Math.abs(demoShot-shot)<.001) demoShot=shot;
    if(demoPlaying && !shot && !demoShot && !pointers.size) {
      orbit(seconds*12,seconds*7*Math.cos(now*.00016));
    }
    return demoPlaying || demoShot>0;
  }

  function render(now) {
    frame = null;
    if (document.hidden || contextLost) return;
    const elapsed = lastFrameTime === null ? frameInterval : now - lastFrameTime;
    if (elapsed < frameInterval - 1) {
      requestRender();
      return;
    }
    lastFrameTime = now;
    updatePinch();
    const atlasTarget=Number(standalone && !coverOpen && !compactAtlas.matches && atlasOpen && atlasFrame.width>0);
    atlasFrame.amount=blend(atlasFrame.amount,atlasTarget,reducedMotion.matches?1:1-Math.exp(-11*elapsed/1000));
    const framingAtlas=Math.abs(atlasFrame.amount-atlasTarget)>.002;
    if(!framingAtlas) atlasFrame.amount=atlasTarget;
    const orbiting=!coverOpen && (animateDemo(elapsed,now) || animateOpenedWorld(elapsed));
    if(layout==='cosmos') {
      const wasFlying=cosmos.flying();
      if(coverOpen && !coverManual && !pointers.size && !reducedMotion.matches) {
        animateCover(elapsed);
        if(!coverTransition) cosmos.warmCoverWorld(renderer,coverSequence[(coverCueIndex+1)%coverSequence.length]);
      }
      if(standalone) night=blend(night,nightTarget,reducedMotion.matches?1:1-Math.exp(-4.8*elapsed/1000));
      const transition=coverOpen?coverTransition:null;
      const autoClear=renderer.autoClear;
      let landed;
      try {
        if(transition) {
          const seconds=Math.min(elapsed/1000,.065);
          renderer.autoClear=false;
          renderer.clear();
          cosmos.renderShowcaseDeparture(renderer,seconds,seconds*12*Math.cos(coverTime*.087),transition);
          renderer.clearDepth();
        }
        landed=cosmos.render(renderer,now,reducedMotion.matches,
          pose=>drawTransitSurface(pose,elapsed/1000),atlasOpen || pointers.size>0,
          standalone?night:0,standalone&&!coverOpen?.84:0,coverOpen,atlasFrame,coverOpen?0:demoShot,transition);
      } finally {
        if(transition) renderer.autoClear=autoClear;
      }
      if(coverOpen && planet.dataset.coverReady!=='true') planet.dataset.coverReady='true';
      const atmosphere=cosmos.atmosphere();
      const skyName = atmosphere.name ?? '';
      if (planet.dataset.destinationSky !== skyName) {
        planet.dataset.destinationSky = skyName;
        syncBrowserBackground();
      }
      planet.style.setProperty('--arrival-alpha',atmosphere.opacity);
      if(atmosphere.name==='rose') planet.style.setProperty('--sunset',atmosphere.sunset);
      if(landed) {
        layout='planets';
        fromSpace=true;
        arrive(landed);
        status.textContent=Atlas.regions[active].title.join(' ');
        requestRender();
      } else if(framingAtlas || orbiting || cosmos.flying() || cosmos.needsFrame() || (standalone && Math.abs(night-nightTarget)>.003)) requestRender();
      else {
        if(wasFlying) {
          status.textContent=cosmos.name() ?? '';
          syncLabels();
        }
        if((coverTransition || cosmos.hasRapidMotion()) && !reducedMotion.matches) requestRender();
        else if((cosmos.hasAnimation() || worldOrbitTime!==null) && !reducedMotion.matches) scheduleAmbientFrame(now);
        else lastFrameTime=null;
      }
      return;
    }
    const seconds = elapsed / 1000;
    const still = reducedMotion.matches;
    const flightArc = flight ? advanceFlight(now) : 0;
    const coasting = !pointers.size && !still && velocity.lengthSq() > 100;
    if (coasting) {
      const resistance = 8.5;
      const remaining = Math.exp(-resistance * seconds);
      const travel = (1 - remaining) / resistance;
      orbit(velocity.x * travel, velocity.y * travel);
      velocity.multiplyScalar(remaining);
    }
    const ease = still ? 1 : 1 - Math.exp(-7 * seconds);
    view.slerp(viewTarget, ease);
    if (!flight) zoom = blend(zoom, zoomTarget, ease);
    night = blend(night, nightTarget, still ? 1 : 1 - Math.exp(-4.8 * seconds));
    const turning = view.angleTo(viewTarget) > .002;
    const changingZoom = !flight && Math.abs(zoom - zoomTarget) > .001;
    const changingLight = Math.abs(night - nightTarget) > .003;
    if (!turning) view.copy(viewTarget);
    if (!flight && !changingZoom) zoom = zoomTarget;
    if (!changingLight) night = nightTarget;
    const feature=demoViews[active];
    const shot=demoShot*(1-atlasFrame.amount);
    shotView.copy(view).slerp(feature.view,shot);
    direction.set(0,0,1).applyQuaternion(shotView);
    vertical.set(0,1,0).applyQuaternion(shotView);
    const framing=standalone?(camera.aspect<.8?1.12:1.27):layout==='planets'?(camera.aspect<.8?1.05:1.16):1;
    const far = overviewDistance * framing;
    const mobile = standalone && compactAtlas.matches;
    const near = mobile ? Math.max(10.8,Land.radius+4/camera.aspect) : 6.65;
    let distance = far * (near / far) ** zoom;
    distance=blend(distance,far*(near/far)**(mobile?.52:.55),shot);
    if(atlasFrame.amount) {
      const root=atlas.bodies.get(active).root;
      if(!worldRadii.has(root)) worldRadii.set(root,Cosmos.worldRadius(root));
      distance=blend(distance,Cosmos.fitDistance(worldRadii.get(root),surfaceFov,atlasFrame.span),atlasFrame.amount);
    }
    camera.position.copy(direction).multiplyScalar(distance).add(worldCenter).addScaledVector(vertical,flightArc);
    camera.up.copy(vertical);
    const closeZoom=Math.max(0,zoom);
    center.copy(direction).multiplyScalar(3.7 * closeZoom ** 1.8).addScaledVector(vertical,
      (mobile?.55:1.68)*closeZoom**1.65-(standalone?1.32*(1-closeZoom):0)).lerp(feature.focus,shot).multiplyScalar(1-atlasFrame.amount);
    surfaceLook.copy(center).add(worldCenter);
    if(viewRoll) {
      camera.up.applyAxisAngle(axis.copy(camera.position).sub(surfaceLook).normalize(),viewRoll);
    }
    camera.lookAt(surfaceLook);
    Cosmos.frameForAtlas(camera,atlasFrame);
    if (layout === 'planets' && !flight && !fromSpace) atlas.layoutSatellites(camera,active,destinations,zoomTarget > .39);
    const responsive = framingAtlas || orbiting || Boolean(flight) || now < responsiveUntil || coasting || turning || changingZoom || changingLight;
    drawWorld(seconds,shotView,worldCenter);
    if (responsive) requestRender();
    else if (!still) scheduleAmbientFrame(now);
    else lastFrameTime = null;
  }

  populateStars();
  if(standalone) {
    selectWorld(firstWorld,true);
  } else {
    showDetailed(active);
    syncLabels();
  }
  setTime(nightTarget ? 'night' : 'day');
  setZoom(0, false);
  resize();
  maybeShowTouchHint();
})();
