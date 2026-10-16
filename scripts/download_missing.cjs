const fs = require('fs');
const path = require('path');

const speciesQueries = [
  // Missing existing
  { id: 'tyto-alba', titles: ['Western_barn_owl', 'Barn_owl', 'Tyto_alba'] },
  { id: 'cardinalis-cardinalis', titles: ['Northern_cardinal', 'Cardinalis_cardinalis'] },
  { id: 'melospiza-melodia', titles: ['Song_sparrow', 'Melospiza_melodia'] },
  { id: 'botaurus-lentiginosus', titles: ['American_bittern', 'Botaurus_lentiginosus'] },
  { id: 'pipilo-chlorurus', titles: ['Green-tailed_towhee', 'Pipilo_chlorurus'] },
  { id: 'setophaga-cerulea', titles: ['Cerulean_warbler', 'Setophaga_cerulea'] },
  { id: 'spiza-americana', titles: ['Dickcissel', 'Spiza_americana'] },
  { id: 'streptopelia-turtur', titles: ['European_turtle_dove', 'Streptopelia_turtur'] },
  { id: 'numenius-arquata', titles: ['Eurasian_curlew', 'Numenius_arquata'] },
  { id: 'fratercula-arctica', titles: ['Atlantic_puffin', 'Fratercula_arctica'] },
  { id: 'geronticus-eremita', titles: ['Northern_bald_ibis', 'Geronticus_eremita'] },
  { id: 'alauda-arvensis', titles: ['Eurasian_skylark', 'Alauda_arvensis'] },
  { id: 'grus-japonensis', titles: ['Red-crowned_crane', 'Grus_japonensis'] },
  { id: 'pandion-haliaetus', titles: ['Osprey', 'Pandion_haliaetus'] },
  { id: 'ciconia-ciconia', titles: ['White_stork', 'Ciconia_ciconia'] },
  { id: 'troglodytes-troglodytes', titles: ['Eurasian_wren', 'Troglodytes_troglodytes'] },
  { id: 'anser-anser', titles: ['Greylag_goose', 'Anser_anser'] },
  { id: 'aquila-chrysaetos', titles: ['Golden_eagle', 'Aquila_chrysaetos'] },

  // Missing Indian
  { id: 'pycnonotus-cafer', titles: ['Red-vented_bulbul', 'Pycnonotus_cafer'] },
  { id: 'psittacula-krameri', titles: ['Rose-ringed_parakeet', 'Psittacula_krameri'] },
  { id: 'copsychus-saularis', titles: ['Oriental_magpie-robin', 'Copsychus_saularis'] },
  { id: 'centropus-sinensis', titles: ['Greater_coucal', 'Centropus_sinensis'] },
  { id: 'halcyon-smyrnensis', titles: ['White-throated_kingfisher', 'Halcyon_smyrnensis'] },
  { id: 'oriolus-kundoo', titles: ['Indian_golden_oriole', 'Oriolus_kundoo', 'Eurasian_golden_oriole'] },
  { id: 'dicrurus-macrocercus', titles: ['Black_drongo', 'Dicrurus_macrocercus'] },
  { id: 'ardeola-grayii', titles: ['Indian_pond_heron', 'Ardeola_grayii'] },
  { id: 'bubulcus-ibis', titles: ['Western_cattle_egret', 'Cattle_egret', 'Bubulcus_ibis'] },
  { id: 'egretta-garzetta', titles: ['Little_egret', 'Egretta_garzetta'] },
  { id: 'accipiter-badius', titles: ['Shikra', 'Accipiter_badius'] },
  { id: 'ocyceros-birostris', titles: ['Indian_grey_hornbill', 'Ocyceros_birostris'] },
  { id: 'dendrocitta-vagabunda', titles: ['Rufous_treepie', 'Dendrocitta_vagabunda'] },
  { id: 'orthotomus-sutorius', titles: ['Common_tailorbird', 'Orthotomus_sutorius'] },
];

const targetDir = path.join(__dirname, '..', 'public', 'images', 'birds');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  for (const item of speciesQueries) {
    const dest = path.join(targetDir, `${item.id}.jpg`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 2000) {
      console.log(`Skipping existing valid file: ${item.id}`);
      continue;
    }

    let foundThumb = null;
    for (const title of item.titles) {
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
          {
            headers: {
              'User-Agent': 'BirdSongResearch/2.0 (research-bot; ornithology@research.org)',
              Accept: 'application/json',
            },
          }
        );
        if (!res.ok) continue;
        const data = await res.json();
        if (data.thumbnail?.source) {
          foundThumb = data.thumbnail.source;
          break;
        }
      } catch (e) {
        // try next title
      }
      await sleep(300);
    }

    if (foundThumb) {
      try {
        const imgRes = await fetch(foundThumb, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          fs.writeFileSync(dest, buf);
          console.log(`Successfully saved ${item.id} (${buf.length} bytes)`);
        } else {
          console.warn(`HTTP ${imgRes.status} for ${item.id} thumbnail`);
        }
      } catch (e) {
        console.error(`Error downloading ${item.id}: ${e.message}`);
      }
    } else {
      console.warn(`No thumbnail found for ${item.id}`);
    }

    await sleep(400);
  }
}

run().catch(console.error);
