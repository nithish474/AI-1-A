const fs = require('fs');
const path = require('path');

const speciesList = [
  // Existing 41
  { id: 'turdus-migratorius', title: 'American_robin' },
  { id: 'poecile-atricapillus', title: 'Black-capped_chickadee' },
  { id: 'bubo-virginianus', title: 'Great_horned_owl' },
  { id: 'tyto-alba', title: 'Barn_owl' },
  { id: 'cardinalis-cardinalis', title: 'Northern_cardinal' },
  { id: 'melospiza-melodia', title: 'Song_sparrow' },
  { id: 'corvus-brachyrhynchos', title: 'American_crow' },
  { id: 'dryocopus-pileatus', title: 'Pileated_woodpecker' },
  { id: 'buteo-jamaicensis', title: 'Red-tailed_hawk' },
  { id: 'erithacus-rubecula', title: 'European_robin' },
  { id: 'luscinia-megarhynchos', title: 'Common_nightingale' },
  { id: 'zenaida-macroura', title: 'Mourning_dove' },
  { id: 'falco-peregrinus', title: 'Peregrine_falcon' },
  { id: 'botaurus-lentiginosus', title: 'American_bittern' },
  { id: 'pipilo-chlorurus', title: 'Green-tailed_towhee' },
  { id: 'setophaga-cerulea', title: 'Cerulean_warbler' },
  { id: 'spiza-americana', title: 'Dickcissel' },
  { id: 'streptopelia-turtur', title: 'European_turtle_dove' },
  { id: 'numenius-arquata', title: 'Eurasian_curlew' },
  { id: 'fratercula-arctica', title: 'Atlantic_puffin' },
  { id: 'aythya-ferina', title: 'Common_pochard' },
  { id: 'balaeniceps-rex', title: 'Shoebill' },
  { id: 'rhynchopsitta-pachyrhyncha', title: 'Thick-billed_parrot' },
  { id: 'geronticus-eremita', title: 'Northern_bald_ibis' },
  { id: 'leucopsar-rothschildi', title: 'Bali_myna' },
  { id: 'strigops-habroptilus', title: 'K%C4%81k%C4%81p%C5%8D', altTitle: 'Kakapo' },
  { id: 'chlorochrysa-nitidissima', title: 'Multicolored_tanager' },
  { id: 'parus-major', title: 'Great_tit' },
  { id: 'sitta-europaea', title: 'Eurasian_nuthatch' },
  { id: 'alauda-arvensis', title: 'Eurasian_skylark' },
  { id: 'grus-japonensis', title: 'Red-crowned_crane' },
  { id: 'pandion-haliaetus', title: 'Osprey' },
  { id: 'ciconia-ciconia', title: 'White_stork' },
  { id: 'coracias-garrulus', title: 'European_roller' },
  { id: 'upupa-epops', title: 'Eurasian_hoopoe' },
  { id: 'alcedo-atthis', title: 'Common_kingfisher' },
  { id: 'troglodytes-troglodytes', title: 'Eurasian_wren' },
  { id: 'cuculus-canorus', title: 'Common_cuckoo' },
  { id: 'archilochus-colubris', title: 'Ruby-throated_hummingbird' },
  { id: 'anser-anser', title: 'Greylag_goose' },
  { id: 'aquila-chrysaetos', title: 'Golden_eagle' },

  // Indian Birds (26)
  { id: 'pavo-cristatus', title: 'Indian_peafowl' },
  { id: 'copsychus-fulicatus', title: 'Indian_robin' },
  { id: 'acridotheres-tristis', title: 'Common_myna' },
  { id: 'corvus-splendens', title: 'House_crow' },
  { id: 'eudynamys-scolopaceus', title: 'Asian_koel' },
  { id: 'pycnonotus-cafer', title: 'Red-vented_bulbul' },
  { id: 'psittacula-krameri', title: 'Rose-ringed_parakeet' },
  { id: 'cuculus-micropterus', title: 'Indian_cuckoo' },
  { id: 'copsychus-saularis', title: 'Oriental_magpie-robin' },
  { id: 'centropus-sinensis', title: 'Greater_coucal' },
  { id: 'halcyon-smyrnensis', title: 'White-throated_kingfisher' },
  { id: 'spilopelia-chinensis', title: 'Spotted_dove' },
  { id: 'oriolus-kundoo', title: 'Indian_golden_oriole' },
  { id: 'dicrurus-macrocercus', title: 'Black_drongo' },
  { id: 'cinnyris-asiaticus', title: 'Purple_sunbird' },
  { id: 'ardeola-grayii', title: 'Indian_pond_heron' },
  { id: 'bubulcus-ibis', title: 'Cattle_egret' },
  { id: 'egretta-garzetta', title: 'Little_egret' },
  { id: 'haliastur-indus', title: 'Brahminy_kite' },
  { id: 'accipiter-badius', title: 'Shikra' },
  { id: 'ocyceros-birostris', title: 'Indian_grey_hornbill' },
  { id: 'dendrocitta-vagabunda', title: 'Rufous_treepie' },
  { id: 'argya-striata', title: 'Jungle_babbler' },
  { id: 'orthotomus-sutorius', title: 'Common_tailorbird' },
  { id: 'aegithina-tiphia', title: 'Common_iora' },
];

const targetDir = path.join(__dirname, '..', 'public', 'images', 'birds');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'BirdSongResearch/1.0 (bioacoustics-avian-study; contact@birdsong-research.org)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${title}`);
  }
  return res.json();
}

async function downloadImage(imgUrl, destPath) {
  const res = await fetch(imgUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) {
    throw new Error(`Image download HTTP ${res.status} for ${imgUrl}`);
  }
  const arrayBuf = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuf));
}

async function run() {
  console.log(`Starting image download for ${speciesList.length} species...`);
  const imageIndex = {};

  for (let i = 0; i < speciesList.length; i++) {
    const sp = speciesList[i];
    const outPath = path.join(targetDir, `${sp.id}.jpg`);
    const relUrl = `/images/birds/${sp.id}.jpg`;

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 2000) {
      console.log(`[${i + 1}/${speciesList.length}] Already exists: ${sp.id}`);
      imageIndex[sp.id] = relUrl;
      continue;
    }

    let summary = null;
    try {
      summary = await fetchJson(sp.title);
    } catch (e) {
      if (sp.altTitle) {
        try {
          await sleep(500);
          summary = await fetchJson(sp.altTitle);
        } catch (e2) {
          console.warn(`Failed both titles for ${sp.id}: ${e2.message}`);
        }
      } else {
        console.warn(`Failed to fetch summary for ${sp.id}: ${e.message}`);
      }
    }

    let imgUrl = summary?.originalimage?.source || summary?.thumbnail?.source;
    if (imgUrl) {
      imgUrl = imgUrl.split('?')[0]; // strip query string
      try {
        await sleep(300);
        await downloadImage(imgUrl, outPath);
        console.log(`[${i + 1}/${speciesList.length}] Downloaded: ${sp.id} (${fs.statSync(outPath).size} bytes)`);
        imageIndex[sp.id] = relUrl;
      } catch (e) {
        console.error(`Failed downloading image for ${sp.id} from ${imgUrl}: ${e.message}`);
      }
    } else {
      console.warn(`No image found in summary for ${sp.id}`);
    }

    await sleep(650); // respect rate limits
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'src', 'data', 'birdImages.json'),
    JSON.stringify(imageIndex, null, 2)
  );
  console.log(`Finished. Saved image mapping for ${Object.keys(imageIndex).length} birds.`);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
