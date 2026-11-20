const WORDS = [
  ['Simmering', 'Simmered'], ['Tinkering', 'Tinkered'], ['Brewing', 'Brewed'], ['Noodling', 'Noodled'],
  ['Untangling', 'Untangled'], ['Percolating', 'Percolated'], ['Sketching', 'Sketched'], ['Whittling', 'Whittled'],
  ['Stirring', 'Stirred'], ['Kneading', 'Kneaded'], ['Shaping', 'Shaped'], ['Plotting', 'Plotted'],
  ['Puzzling', 'Puzzled'], ['Polishing', 'Polished'], ['Wiring', 'Wired'], ['Weaving', 'Wove'],
  ['Mapping', 'Mapped'], ['Mulling', 'Mulled'], ['Sorting', 'Sorted'], ['Mending', 'Mended'],
  ['Carving', 'Carved'], ['Measuring', 'Measured'], ['Sifting', 'Sifted'], ['Riffing', 'Riffed'],
  ['Fiddling', 'Fiddled'], ['Spinning', 'Spun'], ['Folding', 'Folded'], ['Juggling', 'Juggled'],
  ['Tuning', 'Tuned'], ['Tracing', 'Traced'], ['Layering', 'Layered'], ['Patching', 'Patched'],
  ['Marinating', 'Marinated'], ['Hatching', 'Hatched'], ['Shuffling', 'Shuffled'], ['Knitting', 'Knitted'],
  ['Chiseling', 'Chiseled'], ['Doodling', 'Doodled'], ['Arranging', 'Arranged'], ['Mosaicking', 'Mosaicked'],
  ['Conjuring', 'Conjured'], ['Pondering', 'Pondered'], ['Cogitating', 'Cogitated'], ['Ruminating', 'Ruminated'],
  ['Spelunking', 'Spelunked'], ['Fermenting', 'Fermented'], ['Gallivanting', 'Gallivanted'], ['Hullaballooing', 'Hullaballooed'],
  ['Scheming', 'Schemed'], ['Wrangling', 'Wrangled'], ['Zigzagging', 'Zigzagged'], ['Churning', 'Churned'],
  ['Crunching', 'Crunched'], ['Philosophizing', 'Philosophized'], ['Transmuting', 'Transmuted'], ['Incubating', 'Incubated'],
  ['Germinating', 'Germinated'], ['Deciphering', 'Deciphered'], ['Moseying', 'Moseyed'], ['Befuddling', 'Befuddled'],
];

const past = new Map(WORDS);

export function createPicker(random = Math.random) {
  let previous = -1;
  return () => {
    let next = Math.floor(random() * WORDS.length);
    if (next === previous) next = (next + 1 + Math.floor(random() * (WORDS.length - 1))) % WORDS.length;
    previous = next;
    return WORDS[next][0];
  };
}

export const pickStatusWord = createPicker();
export function pastTense(word) { return past.get(word) ?? word; }
export const statusWords = WORDS.map(([present]) => present);
