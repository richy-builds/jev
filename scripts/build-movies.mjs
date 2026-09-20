// Builds data/movies.json and public/posters/*.jpg from Wikipedia (no API key needed).
// Run: node scripts/build-movies.mjs
//
// Each entry: [wikipediaTitle, displayTitle, year, hook]. The hook is a short,
// plot-first description written for vague-recall search ("the one where...").
// Jev sees id + title + year + hook in state; posters are only for the UI.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FILMS = [
  ["The Shawshank Redemption", "The Shawshank Redemption", 1994, "Wrongly convicted banker quietly tunnels out of prison over decades; friendship with Red; rain scene."],
  ["The Godfather", "The Godfather", 1972, "Mafia patriarch's reluctant son takes over the family business; horse head in a bed; an offer you can't refuse."],
  ["The Dark Knight", "The Dark Knight", 2008, "Batman versus an anarchic Joker who wants to watch the world burn; ferry dilemma; Heath Ledger."],
  ["Pulp Fiction", "Pulp Fiction", 1994, "Interlocking LA crime stories told out of order; hitmen debate burgers; adrenaline shot; twist contest."],
  ["Forrest Gump", "Forrest Gump", 1994, "Simple-minded man runs through decades of American history; box of chocolates; bench and a feather."],
  ["Inception", "Inception", 2010, "Thieves plant an idea inside layered dreams; spinning top ending; city folds over itself."],
  ["Fight Club", "Fight Club", 1999, "Insomniac office worker and a soap salesman start an underground fight club; the twist is they're the same person."],
  ["The Matrix", "The Matrix", 1999, "Hacker learns reality is a simulation; red pill or blue pill; bullet time; agents in sunglasses."],
  ["Goodfellas", "Goodfellas", 1990, "Henry Hill's rise and fall as a Brooklyn mob associate; Joe Pesci's volatile 'what do you mean I'm funny, like a clown?' outburst; Copacabana tracking shot; coked-up paranoid final day; Scorsese."],
  ["Interstellar (film)", "Interstellar", 2014, "Farmer pilot leaves his daughter to find a new planet through a wormhole; time slows near a black hole; bookshelf messages."],
  ["The Silence of the Lambs (film)", "The Silence of the Lambs", 1991, "FBI trainee consults an imprisoned cannibal psychiatrist to catch a killer who skins victims; fava beans."],
  ["Se7en", "Se7en", 1995, "Two detectives hunt a killer staging murders after the seven deadly sins; what's in the box."],
  ["Saving Private Ryan", "Saving Private Ryan", 1998, "Squad sent behind enemy lines to bring home one soldier; brutal D-Day beach landing opening."],
  ["Gladiator (2000 film)", "Gladiator", 2000, "Betrayed Roman general becomes a gladiator to avenge his family; 'are you not entertained'."],
  ["The Prestige (film)", "The Prestige", 2006, "Rival Victorian magicians escalate a feud over a teleportation trick; Tesla machine; twins."],
  ["The Departed", "The Departed", 2006, "Undercover cop inside the mob and a mob mole inside the police hunt each other in Boston; elevator ending."],
  ["Memento (film)", "Memento", 2000, "Man who can't form new memories hunts his wife's killer using tattoos and Polaroids; story runs backwards."],
  ["The Lion King (1994 film)", "The Lion King", 1994, "Lion cub blames himself for his father's death in a stampede and runs away; Hakuna Matata; Hamlet with lions."],
  ["Back to the Future", "Back to the Future", 1985, "Teen travels to 1955 in a DeLorean and must get his parents to fall in love; 88 miles per hour; flux capacitor."],
  ["Alien (film)", "Alien", 1979, "Space freighter crew picked off by a creature that bursts out of a man's chest; Ripley and the cat."],
  ["Aliens (film)", "Aliens", 1986, "Ripley returns with marines to a colony overrun by xenomorphs; power loader fight with the queen; 'get away from her'."],
  ["The Terminator", "The Terminator", 1984, "Killer robot from the future hunts the mother of the resistance leader; 'I'll be back'."],
  ["Terminator 2: Judgment Day", "Terminator 2: Judgment Day", 1991, "Reprogrammed Terminator protects a boy from a liquid-metal shapeshifter; thumbs up into molten steel."],
  ["Jurassic Park (film)", "Jurassic Park", 1993, "Dinosaur theme park goes wrong; T. rex attacks the cars in the rain; raptors in the kitchen."],
  ["Jaws (film)", "Jaws", 1975, "Great white shark terrorizes a beach town; 'you're gonna need a bigger boat'; two-note theme."],
  ["E.T. the Extra-Terrestrial", "E.T. the Extra-Terrestrial", 1982, "Boy hides a stranded alien in his house; bicycle flies across the moon; glowing finger; 'phone home'."],
  ["Raiders of the Lost Ark", "Raiders of the Lost Ark", 1981, "Whip-cracking archaeologist races Nazis to the Ark of the Covenant; giant rolling boulder; melting faces."],
  ["Star Wars (film)", "Star Wars: A New Hope", 1977, "Farm boy joins a rebellion, rescues a princess, and blows up a moon-sized space station; lightsabers and the Force."],
  ["The Empire Strikes Back", "The Empire Strikes Back", 1980, "Rebels flee to an ice planet; Yoda trains Luke in a swamp; 'I am your father'; Han frozen in carbonite."],
  ["Blade Runner", "Blade Runner", 1982, "Cop hunts escaped synthetic humans in rainy neon LA; 'tears in rain'; is he a replicant."],
  ["Blade Runner 2049", "Blade Runner 2049", 2017, "Replicant cop uncovers a buried secret about a child born to a replicant; holographic girlfriend; Harrison Ford returns."],
  ["2001: A Space Odyssey (film)", "2001: A Space Odyssey", 1968, "Apes, a black monolith, and a ship computer HAL that refuses to open the pod bay doors; star child ending."],
  ["A Clockwork Orange (film)", "A Clockwork Orange", 1971, "Violent teen gang leader is brainwashed by the state to feel sick at violence; bowler hats; Beethoven."],
  ["The Shining (film)", "The Shining", 1980, "Writer goes mad caretaking an empty snowbound hotel; 'here's Johnny'; twins in the hallway; hedge maze."],
  ["Apocalypse Now", "Apocalypse Now", 1979, "Soldier sent upriver in Vietnam to assassinate a rogue colonel; helicopters and Wagner; 'the horror'."],
  ["Taxi Driver", "Taxi Driver", 1976, "Lonely insomniac cabbie in New York spirals toward violence; 'you talkin' to me'; mohawk."],
  ["Heat (1995 film)", "Heat", 1995, "Master thief and obsessive detective circle each other in LA; diner conversation; downtown bank shootout."],
  ["Die Hard", "Die Hard", 1988, "Barefoot cop fights terrorists in a skyscraper on Christmas Eve; 'yippee-ki-yay'; Hans Gruber falls."],
  ["Predator (film)", "Predator", 1987, "Commandos in the jungle hunted by an invisible alien trophy hunter; 'get to the chopper'; mud camouflage."],
  ["RoboCop", "RoboCop", 1987, "Murdered Detroit cop rebuilt as a cyborg law enforcer; 'dead or alive, you're coming with me'; satire of corporations."],
  ["Speed (1994 film)", "Speed", 1994, "Bus will explode if it drops below fifty miles an hour; Keanu Reeves and Sandra Bullock."],
  ["Titanic (1997 film)", "Titanic", 1997, "Rich girl and poor artist fall in love on the doomed ocean liner; 'I'm the king of the world'; the door."],
  ["Avatar (2009 film)", "Avatar", 2009, "Paraplegic marine inhabits a blue alien body on a lush moon and sides with the natives; floating mountains."],
  ["Gravity (2013 film)", "Gravity", 2013, "Astronaut stranded in orbit after debris destroys her shuttle; almost nobody else on screen; Sandra Bullock."],
  ["The Martian (film)", "The Martian", 2015, "Astronaut left for dead on Mars grows potatoes in his own waste to survive; 'science the hell out of this'."],
  ["Arrival (film)", "Arrival", 2016, "Linguist decodes the circular language of squid-like aliens and learns to see time non-linearly."],
  ["Ex Machina (film)", "Ex Machina", 2014, "Programmer invited to test whether a beautiful android is conscious; secluded tech billionaire; dance scene."],
  ["Her (2013 film)", "Her", 2013, "Lonely man falls in love with his AI operating system's voice; high-waisted pants; Scarlett Johansson unseen."],
  ["Eternal Sunshine of the Spotless Mind", "Eternal Sunshine of the Spotless Mind", 2004, "Couple erase each other from their memories; he chases her through collapsing recollections; frozen river."],
  ["Being John Malkovich", "Being John Malkovich", 1999, "Puppeteer finds a portal into an actor's head on floor seven and a half."],
  ["The Truman Show", "The Truman Show", 1998, "Man discovers his whole life is a televised show inside a giant dome; sails to the edge of the sky."],
  ["Groundhog Day (film)", "Groundhog Day", 1993, "Weatherman relives the same February day forever until he becomes a better person; Punxsutawney."],
  ["Ghostbusters", "Ghostbusters", 1984, "Parapsychologists start a ghost-catching business in New York; giant marshmallow man; 'who you gonna call'."],
  ["Ferris Bueller's Day Off", "Ferris Bueller's Day Off", 1986, "Teen fakes sick, borrows a Ferrari, and has a perfect day in Chicago; parade lip-sync; 'Bueller? Bueller?'."],
  ["The Breakfast Club", "The Breakfast Club", 1985, "Five stereotyped teens bond during Saturday detention; fist in the air at the end."],
  ["Home Alone", "Home Alone", 1990, "Kid left behind at Christmas defends his house from two burglars with booby traps; aftershave scream."],
  ["Toy Story", "Toy Story", 1995, "Cowboy doll jealous of new spaceman toy; toys come alive when humans leave; 'to infinity and beyond'."],
  ["Toy Story 3", "Toy Story 3", 2010, "Toys donated to a daycare run by a tyrannical strawberry-scented bear; incinerator scene; Andy leaves for college."],
  ["Finding Nemo", "Finding Nemo", 2003, "Anxious clownfish crosses the ocean to find his captured son; forgetful blue fish; 'just keep swimming'."],
  ["Up (2009 film)", "Up", 2009, "Old widower floats his house away with thousands of balloons; heartbreaking wordless married-life montage; talking dog."],
  ["WALL-E", "WALL-E", 2008, "Lonely trash-compacting robot on an abandoned Earth falls for a sleek probe robot; obese humans on a spaceship."],
  ["Inside Out (2015 film)", "Inside Out", 2015, "Personified emotions inside a girl's head; Joy and Sadness get lost; imaginary friend Bing Bong."],
  ["Coco (2017 film)", "Coco", 2017, "Boy crosses into the Land of the Dead on Día de los Muertos to find his musician ancestor; 'Remember Me'."],
  ["Ratatouille (film)", "Ratatouille", 2007, "Rat controls a clumsy chef by pulling his hair in a Paris restaurant; critic's flashback to childhood."],
  ["The Incredibles", "The Incredibles", 2004, "Family of superheroes hiding in suburbia forced back into action; 'no capes'; Syndrome."],
  ["Monsters, Inc.", "Monsters, Inc.", 2001, "Monsters scare kids for energy until a toddler girl sneaks into their world; door vault chase; Boo."],
  ["Spirited Away", "Spirited Away", 2001, "Girl trapped in a spirit bathhouse after her parents turn into pigs; No-Face; Studio Ghibli."],
  ["My Neighbor Totoro", "My Neighbor Totoro", 1988, "Two sisters in rural Japan befriend a giant fluffy forest spirit; cat bus; rainy bus stop."],
  ["Princess Mononoke", "Princess Mononoke", 1997, "Cursed prince caught between forest gods and an iron town; wolf girl; Ghibli."],
  ["Howl's Moving Castle (film)", "Howl's Moving Castle", 2004, "Girl cursed into old age lives in a wizard's walking castle; Calcifer the fire demon; Ghibli."],
  ["Akira (1988 film)", "Akira", 1988, "Biker gang teen gains psychic powers and mutates in Neo-Tokyo; red motorcycle slide; anime."],
  ["Your Name", "Your Name", 2016, "Boy and girl swap bodies across time; comet strikes a town; anime."],
  ["Parasite (2019 film)", "Parasite", 2019, "Poor family cons their way into working for a rich family; secret bunker under the house; Korean; rain flood."],
  ["Oldboy (2003 film)", "Oldboy", 2003, "Man imprisoned in a room for fifteen years without knowing why; hallway hammer fight; live octopus; Korean."],
  ["Train to Busan", "Train to Busan", 2016, "Zombie outbreak on a high-speed train; father and daughter; Korean."],
  ["Crouching Tiger, Hidden Dragon", "Crouching Tiger, Hidden Dragon", 2000, "Warriors chase a stolen legendary sword; fight on top of swaying bamboo; wuxia."],
  ["In the Mood for Love", "In the Mood for Love", 2000, "Two neighbors in 1960s Hong Kong whose spouses are cheating grow close but never act; cheongsams; Wong Kar-wai."],
  ["Amélie", "Amélie", 2001, "Whimsical Paris waitress secretly does good deeds for strangers; garden gnome photos; green and red palette."],
  ["Pan's Labyrinth", "Pan's Labyrinth", 2006, "Girl in Franco's Spain enters a fairy-tale underworld with a faun; pale man with eyes in his hands."],
  ["Cinema Paradiso", "Cinema Paradiso", 1988, "Boy befriends a village projectionist in Sicily; montage of censored kissing scenes at the end."],
  ["Life Is Beautiful", "Life Is Beautiful", 1997, "Father pretends a concentration camp is a game to protect his son; Italian; Roberto Benigni."],
  ["The Lives of Others", "The Lives of Others", 2006, "Stasi agent surveils a playwright in East Berlin and grows sympathetic; German."],
  ["Léon: The Professional", "Léon: The Professional", 1994, "Hitman shelters a 12-year-old girl whose family was killed by a corrupt DEA agent; potted plant; Gary Oldman."],
  ["The Fifth Element", "The Fifth Element", 1997, "Cab driver in a future city protects an orange-haired woman who is the key to stopping evil; blue opera diva."],
  ["Mad Max: Fury Road", "Mad Max: Fury Road", 2015, "Two-hour desert car chase; warlord's wives escape with a one-armed woman; flamethrower guitar."],
  ["No Country for Old Men", "No Country for Old Men", 2007, "Hunter takes drug money and is pursued by a killer with a cattle bolt gun and a bowl haircut; coin toss."],
  ["There Will Be Blood", "There Will Be Blood", 2007, "Ruthless oilman versus a young preacher in early 1900s California; 'I drink your milkshake'; bowling pin."],
  ["Fargo (1996 film)", "Fargo", 1996, "Car salesman hires men to kidnap his wife; pregnant small-town police chief; woodchipper; Minnesota accents."],
  ["The Big Lebowski", "The Big Lebowski", 1998, "Slacker mistaken for a millionaire gets dragged into a kidnapping plot; bowling; rug tied the room together."],
  ["Whiplash (2014 film)", "Whiplash", 2014, "Jazz drumming student pushed to bleeding hands by an abusive conductor; 'not quite my tempo'."],
  ["La La Land", "La La Land", 2016, "Jazz pianist and aspiring actress fall in love in LA; freeway opening number; dancing in the planetarium."],
  ["The Grand Budapest Hotel", "The Grand Budapest Hotel", 2014, "Concierge and lobby boy framed for murder after inheriting a painting; pastel symmetry; Wes Anderson."],
  ["Get Out", "Get Out", 2017, "Black man visits white girlfriend's family who hypnotize and body-swap Black people; teacup; the sunken place."],
  ["Hereditary (film)", "Hereditary", 2018, "Family grief turns into demonic cult horror; miniature houses; decapitation by telephone pole."],
  ["Midsommar", "Midsommar", 2019, "Grieving woman joins boyfriend at a Swedish midsummer festival that turns into a cult ritual; all in daylight; flower crown."],
  ["A Quiet Place", "A Quiet Place", 2018, "Family survives in silence because monsters hunt by sound; nail on the stairs; sign language."],
  ["The Exorcist", "The Exorcist", 1973, "Priests try to exorcise a demon from a twelve-year-old girl; spinning head; pea soup; spider walk."],
  ["Halloween (1978 film)", "Halloween", 1978, "Masked silent killer stalks babysitters in a suburb; escaped from an asylum; piano theme."],
  ["Psycho (1960 film)", "Psycho", 1960, "Woman steals money and stops at a motel run by a mother-obsessed man; shower murder; Hitchcock."],
  ["Vertigo (film)", "Vertigo", 1958, "Detective with a fear of heights obsessed with a woman he failed to save; bell tower; Hitchcock."],
  ["Rear Window", "Rear Window", 1954, "Photographer with a broken leg spies on neighbors and suspects a murder across the courtyard; Hitchcock."],
  ["Casablanca (film)", "Casablanca", 1942, "Cynical bar owner in wartime Morocco helps his old flame escape with her husband; 'here's looking at you, kid'."],
  ["Citizen Kane", "Citizen Kane", 1941, "Reporter investigates a newspaper tycoon's dying word; 'Rosebud' is a sled."],
  ["12 Angry Men (1957 film)", "12 Angry Men", 1957, "One juror slowly convinces eleven others that a teen may be innocent; whole film in one room."],
  ["Singin' in the Rain", "Singin' in the Rain", 1952, "Silent film stars struggle with the arrival of talkies; lamppost dance in the rain."],
  ["The Wizard of Oz (1939 film)", "The Wizard of Oz", 1939, "Tornado carries a Kansas girl to a colorful land; yellow brick road; ruby slippers; flying monkeys."],
  ["It's a Wonderful Life", "It's a Wonderful Life", 1946, "Suicidal man shown by an angel what his town would be like if he'd never been born; Christmas classic."],
  ["Lawrence of Arabia (film)", "Lawrence of Arabia", 1962, "British officer unites Arab tribes in the desert during WWI; match cut to the sunrise; epic."],
  ["The Good, the Bad and the Ugly", "The Good, the Bad and the Ugly", 1966, "Three gunmen race for buried Confederate gold; cemetery standoff; Ennio Morricone whistle theme."],
  ["Seven Samurai", "Seven Samurai", 1954, "Village hires seven ronin to defend against bandits; Kurosawa; rain battle."],
  ["Rashomon", "Rashomon", 1950, "A rape and murder retold from four contradictory perspectives; Kurosawa."],
  ["The Seventh Seal", "The Seventh Seal", 1957, "Medieval knight plays chess with Death during the plague; Bergman."],
  ["Chinatown (1974 film)", "Chinatown", 1974, "Private eye uncovers water corruption and a dark family secret in 1930s LA; nose slit; 'forget it, Jake'."],
  ["Rocky", "Rocky", 1976, "Small-time Philadelphia boxer gets a shot at the heavyweight champ; running up the museum steps; 'Adrian!'."],
  ["One Flew Over the Cuckoo's Nest (film)", "One Flew Over the Cuckoo's Nest", 1975, "Rebellious inmate rallies mental patients against a cold head nurse; Nurse Ratched; Chief throws the sink."],
  ["Network (1976 film)", "Network", 1976, "News anchor has an on-air breakdown and becomes a ratings hit; 'I'm as mad as hell'."],
  ["Annie Hall", "Annie Hall", 1977, "Neurotic comedian recalls his failed romance; lobsters; Woody Allen breaks the fourth wall."],
  ["Schindler's List", "Schindler's List", 1993, "German industrialist saves Jews by employing them in his factory; black and white; girl in a red coat."],
  ["Braveheart", "Braveheart", 1995, "Scottish rebel leads a revolt against English rule; blue face paint; 'freedom!'."],
  ["Unforgiven", "Unforgiven", 1992, "Retired outlaw takes one last bounty job; deconstructs the Western; Clint Eastwood."],
  ["The Usual Suspects", "The Usual Suspects", 1995, "Cripple recounts a heist to police; the whole story was made up from a bulletin board; Keyser Söze."],
  ["L.A. Confidential (film)", "L.A. Confidential", 1997, "Three 1950s LA cops uncover police corruption behind a diner massacre; Rollo Tomasi."],
  ["Reservoir Dogs", "Reservoir Dogs", 1992, "Aftermath of a botched jewel heist in a warehouse; color-coded names; ear cut off to 'Stuck in the Middle with You'."],
  ["Kill Bill: Volume 1", "Kill Bill: Volume 1", 2003, "Bride wakes from a coma and hunts the assassins who shot her at her wedding; yellow jumpsuit; Crazy 88 fight."],
  ["Inglourious Basterds", "Inglourious Basterds", 2009, "Jewish-American soldiers scalp Nazis; cinema owner plots to burn Hitler; 'that's a bingo'; opening farmhouse scene."],
  ["Django Unchained", "Django Unchained", 2012, "Freed slave and a German bounty hunter rescue his wife from a plantation; Tarantino Western."],
  ["Once Upon a Time in Hollywood", "Once Upon a Time in Hollywood", 2019, "Fading TV actor and his stunt double in 1969 LA; Manson family gets a flamethrower; Tarantino."],
  ["Trainspotting (film)", "Trainspotting", 1996, "Edinburgh heroin addicts; 'choose life'; the worst toilet in Scotland; dead baby on the ceiling."],
  ["Snatch (film)", "Snatch", 2000, "Stolen diamond, bare-knuckle boxing, and an unintelligible Irish traveller; Guy Ritchie; 'd'ya like dags'."],
  ["Shaun of the Dead", "Shaun of the Dead", 2004, "Slacker fights a zombie apocalypse with a cricket bat and hides in the pub; British comedy."],
  ["Hot Fuzz", "Hot Fuzz", 2007, "Overachieving London cop transferred to a village where accidents are actually murders; 'the greater good'."],
  ["The Social Network", "The Social Network", 2010, "Harvard student invents Facebook and gets sued by his friend and the rowing twins; deposition scenes."],
  ["Zodiac (film)", "Zodiac", 2007, "Cartoonist obsessively hunts the unsolved San Francisco serial killer who sent ciphers to newspapers; basement scene."],
  ["Gone Girl (film)", "Gone Girl", 2014, "Wife vanishes and frames her husband; 'cool girl' monologue; the twist is she staged it."],
  ["Prisoners (2013 film)", "Prisoners", 2013, "Father tortures a suspect after his daughter is abducted; detective with a neck tattoo; whistle at the end."],
  ["Sicario (2015 film)", "Sicario", 2015, "FBI agent dragged into a murky CIA operation against a Mexican cartel; tunnel raid in night vision."],
  ["Dune (2021 film)", "Dune", 2021, "Noble family takes over a desert planet with giant sandworms and spice; Timothée Chalamet; 'fear is the mind-killer'."],
  ["Oppenheimer (film)", "Oppenheimer", 2023, "Biopic of the physicist who built the atomic bomb; Trinity test; security hearing; Nolan."],
  ["Barbie (film)", "Barbie", 2023, "Doll leaves Barbieland for the real world after thinking about death; Ken discovers patriarchy; pink everything."],
  ["Everything Everywhere All at Once", "Everything Everywhere All at Once", 2022, "Laundromat owner hops between multiverse versions of herself; hot dog fingers; googly-eyed rock; bagel."],
  ["Joker (2019 film)", "Joker", 2019, "Failed clown and comedian in Gotham descends into violence; dancing on the stairs; Joaquin Phoenix."],
  ["Spider-Man: Into the Spider-Verse", "Spider-Man: Into the Spider-Verse", 2018, "Teen Miles Morales meets Spider-People from other dimensions; comic-book animation style; Spider-Ham."],
  ["Avengers: Endgame", "Avengers: Endgame", 2019, "Heroes travel through time to undo Thanos's snap; 'I am Iron Man'; Cap lifts the hammer; portals."],
  ["Iron Man (2008 film)", "Iron Man", 2008, "Weapons billionaire builds an armored suit in a cave after being kidnapped; starts the MCU."],
  ["Black Panther (film)", "Black Panther", 2018, "King of a hidden high-tech African nation faces a challenger from Oakland; vibranium; 'Wakanda forever'."],
  ["Guardians of the Galaxy (film)", "Guardians of the Galaxy", 2014, "Misfit space outlaws with a talking raccoon and a tree who says three words; Walkman mixtape; 'I am Groot'."],
  ["Logan (film)", "Logan", 2017, "Aging Wolverine protects a young mutant girl on a road trip; gritty; dying Professor X."],
  ["The Lord of the Rings: The Fellowship of the Ring", "The Fellowship of the Ring", 2001, "Hobbit sets out to destroy a cursed ring; wizard fights a fire demon on a bridge; 'you shall not pass'."],
  ["The Lord of the Rings: The Return of the King", "The Return of the King", 2003, "Final battle for Middle-earth; ring thrown into the volcano; Gollum falls; eleven Oscars; multiple endings."],
  ["Harry Potter and the Philosopher's Stone (film)", "Harry Potter and the Philosopher's Stone", 2001, "Orphan learns he's a wizard and goes to a magic boarding school; sorting hat; three-headed dog."],
  ["Pirates of the Caribbean: The Curse of the Black Pearl", "Pirates of the Caribbean: The Curse of the Black Pearl", 2003, "Drunken swaying pirate captain and cursed skeleton crew who can't die; Johnny Depp."],
  ["Shrek", "Shrek", 2001, "Grumpy green ogre rescues a princess with a talking donkey; princess is secretly an ogre; fairy-tale parody."],
  ["Frozen (2013 film)", "Frozen", 2013, "Princess with ice powers accidentally freezes her kingdom; 'Let It Go'; talking snowman."],
  ["Moana (2016 film)", "Moana", 2016, "Polynesian chief's daughter sails to return a goddess's heart with a shape-shifting demigod; 'You're Welcome'."],
  ["Zootopia", "Zootopia", 2016, "Rabbit cop and con-artist fox solve a conspiracy in a city of animals; sloth at the DMV."],
  ["Beauty and the Beast (1991 film)", "Beauty and the Beast", 1991, "Bookish girl imprisoned in a cursed prince's castle where the furniture talks; ballroom dance; enchanted rose."],
  ["Aladdin (1992 Disney film)", "Aladdin", 1992, "Street thief finds a lamp with a fast-talking blue genie; magic carpet; Robin Williams."],
  ["The Princess Bride (film)", "The Princess Bride", 1987, "Grandpa reads a fairy tale: farm boy rescues a princess; 'inconceivable'; 'my name is Inigo Montoya'."],
  ["The Goonies", "The Goonies", 1985, "Kids follow a pirate treasure map through booby-trapped caves; Sloth and Chunk; truffle shuffle."],
  ["Stand by Me (film)", "Stand by Me", 1986, "Four boys hike along train tracks to find a dead body; coming of age; leeches."],
  ["The Karate Kid", "The Karate Kid", 1984, "Bullied teen learns karate from a handyman; 'wax on, wax off'; crane kick."],
  ["Top Gun", "Top Gun", 1986, "Cocky navy fighter pilot at an elite flight school; beach volleyball; Goose dies; 'need for speed'."],
  ["Top Gun: Maverick", "Top Gun: Maverick", 2022, "Aging pilot trains a new generation for an impossible canyon mission; Goose's son; practical jet stunts."],
  ["Skyfall", "Skyfall", 2012, "Bond presumed dead returns to protect M from a vengeful ex-agent; Scottish estate finale; Javier Bardem blonde villain."],
  ["Casino Royale (2006 film)", "Casino Royale", 2006, "Newly minted 007 plays a high-stakes poker game against a banker who weeps blood; Daniel Craig's first."],
  ["The Bourne Identity (2002 film)", "The Bourne Identity", 2002, "Amnesiac fished from the sea discovers he's a trained assassin; Swiss bank safe deposit box; Mini Cooper chase."],
  ["John Wick (film)", "John Wick", 2014, "Retired hitman goes on a rampage after gangsters kill his puppy; the Continental hotel; gun-fu."],
  ["Drive (2011 film)", "Drive", 2011, "Stoic getaway driver with a scorpion jacket protects his neighbor; elevator kiss then head stomp; synth soundtrack."],
  ["Nightcrawler (film)", "Nightcrawler", 2014, "Gaunt sociopath films crime scenes for local news in LA at night; Jake Gyllenhaal."],
  ["Baby Driver", "Baby Driver", 2017, "Getaway driver with tinnitus times heists to his playlists; car chases cut to music."],
  ["Edge of Tomorrow", "Edge of Tomorrow", 2014, "Soldier relives the same alien battle every time he dies; Groundhog Day as war movie; Tom Cruise."],
  ["Minority Report (film)", "Minority Report", 2002, "Cop in a precrime unit that arrests people before they murder is himself accused; gesture screens; eye transplant."],
  ["Children of Men", "Children of Men", 2006, "No child has been born in eighteen years; man escorts the one pregnant woman; long single-take battle."],
  ["District 9", "District 9", 2009, "Aliens confined to a slum in Johannesburg; bureaucrat slowly transforms into one; found-footage style."],
  ["Moon (2009 film)", "Moon", 2009, "Lone lunar miner near the end of his contract discovers he's a clone; robot voiced by Kevin Spacey."],
  ["Donnie Darko", "Donnie Darko", 2001, "Troubled teen sees a giant creepy rabbit predicting the end of the world; jet engine falls into his bedroom."],
  ["Requiem for a Dream", "Requiem for a Dream", 2000, "Four addictions spiral to ruin; mother hooked on diet pills; refrigerator hallucination; rapid montages."],
  ["Black Swan (film)", "Black Swan", 2010, "Ballerina cracks under pressure to dance both swans; feathers grow from her skin; Natalie Portman."],
  ["Good Will Hunting", "Good Will Hunting", 1997, "Janitor at MIT is secretly a math genius; therapist repeats 'it's not your fault'; Boston."],
  ["Dead Poets Society", "Dead Poets Society", 1989, "Inspirational English teacher at a strict boarding school; 'carpe diem'; 'O Captain! My Captain!' on desks."],
  ["A Beautiful Mind (film)", "A Beautiful Mind", 2001, "Mathematician's schizophrenia makes him imagine a roommate and a spy handler; Nobel Prize."],
  ["The Imitation Game", "The Imitation Game", 2014, "Alan Turing breaks the Nazi Enigma code and is later prosecuted for being gay; Benedict Cumberbatch."],
  ["The King's Speech", "The King's Speech", 2010, "Stammering future king works with an unconventional Australian speech therapist before WWII."],
  ["Slumdog Millionaire", "Slumdog Millionaire", 2008, "Mumbai street kid explains how his life taught him every quiz show answer; 'Jai Ho' dance."],
  ["Little Miss Sunshine", "Little Miss Sunshine", 2006, "Dysfunctional family drives a yellow VW bus to a child beauty pageant; grandpa dies on the way; 'Super Freak' dance."],
  ["Juno (film)", "Juno", 2007, "Sarcastic pregnant teen picks adoptive parents for her baby; hamburger phone; indie soundtrack."],
  ["Lady Bird (film)", "Lady Bird", 2017, "Sacramento teen fights with her mother and dreams of the East Coast; jumps out of a moving car."],
  ["Moonlight (2016 film)", "Moonlight", 2016, "Black gay boy in Miami grows up in three chapters; taught to swim by a drug dealer; won Best Picture after the envelope mix-up."],
  ["12 Years a Slave (film)", "12 Years a Slave", 2013, "Free Black man kidnapped and sold into slavery in the pre-Civil War South; true story."],
  ["Boyhood (2014 film)", "Boyhood", 2014, "Boy grows from six to eighteen, filmed with the same actors over twelve real years."],
  ["Before Sunrise", "Before Sunrise", 1995, "Two strangers meet on a train and walk around Vienna talking all night; Ethan Hawke and Julie Delpy."],
  ["Lost in Translation (film)", "Lost in Translation", 2003, "Aging actor and a young wife bond in a Tokyo hotel; whiskey ad; whispered goodbye we never hear."],
  ["Roma (2018 film)", "Roma", 2018, "Housekeeper in 1970s Mexico City; black and white; beach rescue; Cuarón."],
  ["The Shape of Water", "The Shape of Water", 2017, "Mute cleaner falls in love with an amphibian man held in a Cold War lab; Guillermo del Toro."],
  ["Spotlight (film)", "Spotlight", 2015, "Boston Globe reporters expose Catholic Church child abuse cover-up; journalism procedural."],
  ["Room (2015 film)", "Room", 2015, "Mother and five-year-old son held captive in a garden shed; boy escapes rolled in a rug; Brie Larson."],
  ["Brokeback Mountain", "Brokeback Mountain", 2005, "Two cowboys' secret decades-long love affair; 'I wish I knew how to quit you'; Heath Ledger."],
  ["Call Me by Your Name (film)", "Call Me by Your Name", 2017, "Teen's summer romance with his father's grad student in 1980s Italy; the peach; father's speech."],
  ["Portrait of a Lady on Fire", "Portrait of a Lady on Fire", 2019, "Painter secretly paints a bride-to-be on an 18th-century island and they fall in love; French; bonfire song."],
  ["Amadeus (film)", "Amadeus", 1984, "Jealous court composer Salieri recounts sabotaging Mozart; giggling genius; requiem dictation."],
  ["The Pianist (2002 film)", "The Pianist", 2002, "Polish Jewish pianist survives the Warsaw ghetto in hiding; plays Chopin for a German officer; Adrien Brody."],
  ["Cast Away", "Cast Away", 2000, "FedEx man stranded on a desert island befriends a volleyball named Wilson; Tom Hanks."],
  ["Catch Me If You Can", "Catch Me If You Can", 2002, "Teen con artist poses as a pilot, doctor, and lawyer while an FBI agent chases him; Leonardo DiCaprio."],
  ["The Wolf of Wall Street (2013 film)", "The Wolf of Wall Street", 2013, "Stockbroker's drug-fueled fraud empire; quaalude crawl to the Lamborghini; chest-thumping chant."],
  ["The Big Short (film)", "The Big Short", 2015, "Outsiders bet against the housing market before 2008; Margot Robbie in a bathtub explains bonds."],
  ["Moneyball (film)", "Moneyball", 2011, "Baseball GM builds a winning team on statistics with no money; Brad Pitt and Jonah Hill."],
  ["Ocean's Eleven (2001 film)", "Ocean's Eleven", 2001, "Eleven thieves rob three Las Vegas casinos at once; George Clooney and Brad Pitt always eating; fountain ending."],
  ["Mean Girls", "Mean Girls", 2004, "Homeschooled girl infiltrates the popular clique; Burn Book; 'on Wednesdays we wear pink'; 'fetch'."],
  ["Clueless (film)", "Clueless", 1995, "Rich Beverly Hills teen plays matchmaker; 'as if'; computerized closet; loosely Jane Austen's Emma."],
  ["The Devil Wears Prada (film)", "The Devil Wears Prada", 2006, "Aspiring journalist becomes assistant to a terrifying fashion magazine editor; cerulean sweater speech."],
  ["Bridesmaids (2011 film)", "Bridesmaids", 2011, "Maid of honor's life unravels while rival bridesmaid takes over; food poisoning in a bridal shop."],
  ["Superbad (film)", "Superbad", 2007, "Two high school friends try to buy alcohol for a party; fake ID says McLovin."],
  ["The Hangover", "The Hangover", 2009, "Bachelor party wakes up in Vegas with a tiger, a baby, a missing tooth, and no groom."],
  ["Anchorman: The Legend of Ron Burgundy", "Anchorman", 2004, "Sexist 1970s San Diego news anchor threatened by a female co-anchor; news team street brawl; jazz flute."],
  ["Step Brothers (film)", "Step Brothers", 2008, "Two middle-aged men still living at home become stepbrothers; bunk beds; 'Boats 'N Hoes'."],
  ["Dumb and Dumber", "Dumb and Dumber", 1994, "Two idiots drive a dog-shaped van to Aspen to return a briefcase; 'so you're telling me there's a chance'."],
  ["Office Space", "Office Space", 1999, "Hypnotized programmer stops caring about his soul-crushing job; smashing the printer; red stapler; TPS reports."],
  ["Airplane!", "Airplane!", 1980, "Deadpan spoof of disaster films; 'don't call me Shirley'; jive-talking passengers; food poisoning on a plane."],
  ["Monty Python and the Holy Grail", "Monty Python and the Holy Grail", 1975, "King Arthur's quest with coconut horse noises, the Black Knight losing limbs, and a killer rabbit."],
  ["This Is Spinal Tap", "This Is Spinal Tap", 1984, "Mockumentary of a fading heavy metal band; amps go to eleven; tiny Stonehenge."],
  ["When Harry Met Sally...", "When Harry Met Sally...", 1989, "Can men and women be just friends; fake orgasm in a deli; 'I'll have what she's having'."],
  ["Notting Hill (film)", "Notting Hill", 1999, "London bookshop owner dates a Hollywood star; 'just a girl standing in front of a boy'; Hugh Grant."],
  ["Love Actually", "Love Actually", 2003, "Interwoven London love stories at Christmas; cue cards on the doorstep; prime minister dances."],
  ["Pretty Woman", "Pretty Woman", 1990, "Businessman hires a sex worker for a week and falls in love; 'big mistake, huge'; Julia Roberts."],
  ["Dirty Dancing", "Dirty Dancing", 1987, "Teen at a summer resort falls for the dance instructor; 'nobody puts Baby in a corner'; the lift."],
  ["Grease (film)", "Grease", 1978, "1950s high school romance between a greaser and a good girl; 'Summer Nights'; flying car at the end."],
  ["The Sound of Music (film)", "The Sound of Music", 1965, "Nun becomes governess to seven children of a widowed captain in Austria; 'Do-Re-Mi'; flee the Nazis."],
  ["Willy Wonka & the Chocolate Factory", "Willy Wonka & the Chocolate Factory", 1971, "Poor boy wins a golden ticket to tour a candy factory; Oompa Loompas; girl turns into a blueberry; Gene Wilder."],
  ["Big (film)", "Big", 1988, "Boy wishes to be big and wakes up as a thirty-year-old man; giant floor piano in a toy store; Tom Hanks."],
  ["The Sixth Sense", "The Sixth Sense", 1999, "Child psychologist helps a boy who sees dead people; twist: the psychologist is dead."],
  ["The Others (2001 film)", "The Others", 2001, "Mother and light-sensitive children in a dark mansion haunted by intruders; twist: they're the ghosts; Nicole Kidman."],
  ["The Thing (1982 film)", "The Thing", 1982, "Antarctic researchers infiltrated by a shape-shifting alien; blood test scene; paranoia; dog kennel."],
  ["Scream (1996 film)", "Scream", 1996, "Self-aware slasher where teens know the horror movie rules; Ghostface mask; phone calls; Drew Barrymore dies first."],
  ["28 Days Later", "28 Days Later", 2002, "Man wakes from a coma in an empty London after a rage virus; fast zombies; Danny Boyle."],
  ["Zombieland", "Zombieland", 2009, "Survivors follow rules like 'cardio' and 'double tap'; Twinkie quest; Bill Murray cameo."],
  ["Independence Day (1996 film)", "Independence Day", 1996, "Aliens blow up the White House; fighter pilot punches an alien; president gives a speech; Will Smith."],
  ["Apollo 13 (film)", "Apollo 13", 1995, "Astronauts improvise to survive after an oxygen tank explodes; 'Houston, we have a problem'; square peg in a round hole."],
  ["Hidden Figures", "Hidden Figures", 2016, "Three Black women mathematicians at NASA during the space race; segregated bathroom run."],
  ["Contact (1997 American film)", "Contact", 1997, "Astronomer receives an alien signal with instructions to build a machine; Jodie Foster; 'they should have sent a poet'."],
  ["Close Encounters of the Third Kind", "Close Encounters of the Third Kind", 1977, "Man obsessively sculpts a mountain out of mashed potatoes after a UFO sighting; five-note musical greeting."],
  ["WarGames", "WarGames", 1983, "Teen hacker almost starts nuclear war playing a game against a military computer; 'shall we play a game'."],
  ["The Iron Giant", "The Iron Giant", 1999, "Boy befriends a giant robot from space in 1950s Maine; 'Superman'; robot sacrifices himself against a missile."],
  ["How to Train Your Dragon (2010 film)", "How to Train Your Dragon", 2010, "Scrawny Viking teen befriends the dragon he was supposed to kill; Toothless; loses a leg."],
  ["Kung Fu Panda (film)", "Kung Fu Panda", 2008, "Clumsy noodle-shop panda chosen as the Dragon Warrior; 'there is no secret ingredient'."],
  ["Fantastic Mr. Fox (film)", "Fantastic Mr. Fox", 2009, "Stop-motion fox steals from three farmers; 'cuss'; Wes Anderson; George Clooney's voice."],
  ["The Nightmare Before Christmas", "The Nightmare Before Christmas", 1993, "Skeleton king of Halloween Town tries to take over Christmas; stop-motion; Tim Burton."],
  ["Coraline (film)", "Coraline", 2009, "Girl finds a door to a better version of her home where parents have button eyes; stop-motion."],
  ["Paddington 2", "Paddington 2", 2017, "Marmalade-loving bear wrongly jailed, wins over the prisoners; Hugh Grant as a vain actor villain."],
  ["Babe (film)", "Babe", 1995, "Pig raised by sheepdogs learns to herd sheep; 'that'll do, pig'."],
  ["Tangled", "Tangled", 2010, "Rapunzel with magic glowing hair escapes her tower with a thief; floating lanterns; frying pan; Flynn Rider."],
  ["Encanto", "Encanto", 2021, "Colombian family where everyone has a magic gift except one daughter; 'We Don't Talk About Bruno'."],
  ["Soul (2020 film)", "Soul", 2020, "Jazz teacher dies before his big gig and ends up in the Great Before with an unborn soul; body-swap with a cat."],
  ["Big Hero 6 (film)", "Big Hero 6", 2014, "Boy and an inflatable healthcare robot form a superhero team in San Fransokyo; Baymax; fist bump 'balalala'."],
  ["Wreck-It Ralph", "Wreck-It Ralph", 2012, "Arcade game villain wants to be a hero and jumps into other games; candy racing game; Sugar Rush."],
  ["Cars (film)", "Cars", 2006, "Hotshot race car stuck in a forgotten Route 66 town; Lightning McQueen; Tow Mater; 'ka-chow'."],
  ["Shutter Island (film)", "Shutter Island", 2010, "US marshal investigates a disappearance at an asylum on an island; twist: he's a patient; DiCaprio."],
  ["Inside Man", "Inside Man", 2006, "Bank robbers dressed like hostages; detective can't figure out what was stolen; Spike Lee; Denzel."],
  ["Knives Out", "Knives Out", 2019, "Southern-drawl detective investigates a mystery novelist's death; nurse vomits when she lies; donut hole speech."],
];

const UA = "jev-poster-grid-demo/0.1 (local demo; contact via repo owner)";
const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const POSTER_DIR = path.join(ROOT, "public", "posters");
const OUT = path.join(ROOT, "data", "movies.json");

const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polite fetch: pause between calls, back off and retry on 429/5xx.
async function get(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(250);
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("gave up after retries");
}

async function wiki(titles) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1" +
    "&prop=pageimages|extracts|pageprops&ppprop=wikibase_item&piprop=thumbnail&pilicense=any&pithumbsize=400" +
    "&exintro=1&explaintext=1&exsentences=4&exlimit=20&titles=" +
    encodeURIComponent(titles.join("|"));
  const res = await get(url);
  const json = await res.json();
  // Map requested title -> page (following redirects/normalization).
  const byTitle = new Map();
  const norm = new Map((json.query.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((json.query.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = Object.values(json.query.pages);
  for (const t of titles) {
    let final = norm.get(t) ?? t;
    final = redir.get(final) ?? final;
    byTitle.set(t, pages.find((p) => p.title === final));
  }
  return byTitle;
}

// Structured credits come from Wikidata (keyless): P57 director, P161 cast member, P136 genre.
// Q-ids are resolved to English labels in batches of 50.
async function wikidata(qids) {
  const entities = {};
  for (let i = 0; i < qids.length; i += 50) {
    const url = "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=" + qids.slice(i, i + 50).join("|");
    Object.assign(entities, (await (await get(url)).json()).entities ?? {});
  }
  return entities;
}

async function labels(qids) {
  const out = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    // Some items (Christopher Nolan, Q25191) lack an `en` label; the enwiki article title is the fallback.
    const url = "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|sitelinks&sitefilter=enwiki&ids=" + qids.slice(i, i + 50).join("|");
    const json = await (await get(url)).json();
    for (const [id, e] of Object.entries(json.entities ?? {})) {
      const l = e.labels ?? {};
      out.set(id, (l.en ?? l["en-gb"] ?? l["en-ca"] ?? l.mul)?.value ?? e.sitelinks?.enwiki?.title?.replace(/ \(.*\)$/, ""));
    }
  }
  return out;
}

const claimIds = (entity, prop, max = Infinity) =>
  (entity?.claims?.[prop] ?? [])
    .filter((c) => c.mainsnak?.datavalue?.value?.id && c.rank !== "deprecated")
    // Cast claims sometimes carry a billing order (P1545); keep it when present.
    .sort((a, b) => Number(a.qualifiers?.P1545?.[0]?.datavalue?.value ?? 99) - Number(b.qualifiers?.P1545?.[0]?.datavalue?.value ?? 99))
    .slice(0, max)
    .map((c) => c.mainsnak.datavalue.value.id);

async function main() {
  await mkdir(POSTER_DIR, { recursive: true });
  await mkdir(path.dirname(OUT), { recursive: true });

  const seen = new Set();
  const movies = [];
  const missing = [];

  for (let i = 0; i < FILMS.length; i += 20) {
    const batch = FILMS.slice(i, i + 20);
    const pages = await wiki(batch.map((f) => f[0]));
    for (const [wikiTitle, title, year, hook] of batch) {
      const id = slug(`${title}-${year}`);
      if (seen.has(id)) continue;
      seen.add(id);
      const page = pages.get(wikiTitle);
      const src = page?.thumbnail?.source;
      if (!page || page.missing !== undefined || !src) {
        missing.push(wikiTitle);
        continue;
      }
      const file = path.join(POSTER_DIR, `${id}.jpg`);
      if (!existsSync(file)) {
        let img;
        try {
          img = await get(src);
        } catch (e) {
          missing.push(`${wikiTitle} (poster ${e.message})`);
          continue;
        }
        await writeFile(file, Buffer.from(await img.arrayBuffer()));
      }
      // Wikipedia's intro (keyless) is the "fuller description" used by the second-pass
      // request over a handful of films. It is never sent in the per-keystroke call.
      const summary = (page.extract ?? "").replace(/\s+/g, " ").trim();
      movies.push({ id, title, year, hook, summary, poster: `/posters/${id}.jpg`, w: page.thumbnail.width, h: page.thumbnail.height, q: page.pageprops?.wikibase_item });
      process.stdout.write(`\r${movies.length} posters`);
    }
  }
  // Credits and genres from Wikidata, resolved to labels.
  const entities = await wikidata(movies.map((m) => m.q).filter(Boolean));
  const people = new Set();
  for (const m of movies) {
    const e = entities[m.q];
    m._director = claimIds(e, "P57");
    // Animated films credit voice actors (P725) rather than cast members (P161).
    m._cast = claimIds(e, "P161", 5);
    if (!m._cast.length) m._cast = claimIds(e, "P725", 5);
    m._genre = claimIds(e, "P136", 4);
    [...m._director, ...m._cast, ...m._genre].forEach((q) => people.add(q));
  }
  const name = await labels([...people]);
  for (const m of movies) {
    m.director = m._director.map((q) => name.get(q)).filter(Boolean).join(", ") || undefined;
    m.cast = m._cast.map((q) => name.get(q)).filter(Boolean);
    m.genre = m._genre.map((q) => name.get(q)?.replace(/ film$/, "")).filter(Boolean);
    delete m._director; delete m._cast; delete m._genre; delete m.q;
  }
  await writeFile(OUT, JSON.stringify(movies, null, 1));
  console.log(`\nwrote ${movies.length} movies -> ${path.relative(ROOT, OUT)}`);
  if (missing.length) console.log("MISSING:\n  " + missing.join("\n  "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
