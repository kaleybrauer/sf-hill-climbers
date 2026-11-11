SF Hill Climbers: the words on the page

How this file works:
- Each block starts with a line beginning with two hashes and a space. Keep the part before
  the colon as it is: it tells the page where the text goes. The part after the colon is a
  heading or title, and you can change it.
- Blank lines separate paragraphs. **bold** and *italic* work.
- In template blocks, words in {curly braces} are filled in by the page with numbers or
  names. Keep those as they are.
- The build checks this file and stops with a message if a block is missing or misnamed, so
  a typo can't break the live site. Short labels (tabs, buttons, legends) are in index.html.

## link preview
Gradient descent, Momentum, Adam and Muon race uphill across San Francisco. Type your address and see which hill each optimizer reaches.

## subtitle
loss = −elevation

## intro
Pick a starting point anywhere in San Francisco! Four optimizers will climb as high as they can. The loss decreases with elevation, so every hilltop is a local minimum and Mount Davidson (928 ft) is the global minimum of the loss.

## basins intro
Each patch of color is a basin of attraction: all the starting points from which that optimizer ends on the same hilltop. Darker violet means a higher summit, so a lower loss. At its default learning rate, SGD's map is almost exactly the terrain's own basins, where walking straight uphill in tiny steps would take you, so it makes a good baseline for the others. Hover to compare; click to race from that spot.

## template disagreement
All four agree on {agree} of the city.

On the other {other}, at least one climber ends somewhere else: two different endings on {two}, three on {three}, and all four different on {four}.

The most different pair is **{pair_a}** and **{pair_b}**, which disagree on {pair_pct} of starting points. The most alike are {alike_a} and {alike_b}, at {alike_pct}.

Disagreement collects along ridges and saddles, where a small difference in the first few steps decides which side of the ridge a climber goes down, and on flat ground, where some climbers keep walking and others stop.

## hint beta
Used by Momentum, Nesterov, Adam (β₁), Lion and Muon

## hint noise
Random error added to every slope reading, like a mini-batch

## hint rotate
The optimizers measure slope along turned axes. Only per-axis methods notice.

## section try: Things to try

## card judah: 9th & Judah
Three climbers, three hills: the shoulder of Forest Hill, Larsen Peak and Mount Sutro. Now drag β: at 0.5 they all stop on the same shoulder, and near 0.99 they spread across four different summits.

## card glen: Glen Park BART
Only Momentum carries enough speed through a shallow local minimum (a 400 ft rise) to reach Mount Davidson, the global minimum.

## card hayes: Hayes Valley
Three climbers go to Alamo Square. Adam's diagonal steps carry it to Lafayette Park instead.

## card rotate: Rotate the axes 30°
Same start in Hayes Valley. Adam now picks Alamo Square, and SGD, Momentum and Muon trace exactly the same paths as before.

## card ocean: Ocean Beach at Judah
The Sunset is a long, gentle ramp. SGD's steps shrink with the slope, so it needs more than twice as many steps as Adam to reach the top.

## card lion: Swap Adam for Lion
Lion only moves diagonally, a fixed distance per axis. From Ocean Beach it walks across the whole Sunset to Forest Hill.

## card anneal: Swap in simulated annealing
It ignores the slope and sometimes steps downhill on purpose. From Haight & Ashbury it reaches Mount Sutro. Across the city it reaches a top-four summit 41% of the time; the gradient climbers, 4–6%.

## card anneal-momentum: Anneal Momentum
Momentum with a huge step (η 256), β 0.95, noise and cosine decay climbs from Dolores Park to the city's highest summits while the others stop on Dolores Heights. With these settings, tuned for this map, it gets there from half of all starts, up from 6%.

## section climbers: The climbers
Each climber is a different optimizer. Each one tries to climb to higher ground after seeing the slope of the ground where it stands, as a two-number gradient g. η is the learning rate you can set in the panel.

The default learning rates are sensible picks that are not tuned to make any optimizer win. Where each one ends up depends strongly on η, so try the sliders.

## climber sgd: Plain gradient descent
Steps in proportion to the slope. Steep ground means big strides and flat ground means tiny ones, so it crawls across the Sunset and the Mission.

## climber momentum: Heavy ball
Keeps a running velocity. It speeds up on long slopes, carries through shallow local minima instead of stopping in them, and overshoots before settling.

## climber adam: Per-axis normalized
Divides each axis's step by that axis's recent slope size, so it moves about η per axis per step on steep and flat ground alike. That per-axis treatment is also why it favors diagonals.

## climber muon: Orthogonalized momentum
Normalizes the momentum, then runs a few Newton–Schulz iterations, a cheap way to push every singular value of a matrix toward 1. A 1×2 matrix has only one, so this leaves a fixed step of about 0.7 η along the momentum.

## climber nesterov: Look-ahead momentum
Momentum that adds the current slope on top of the updated velocity, which damps some of the overshoot.

## climber rmsprop: Adam without momentum
Per-axis normalized steps from the current slope. Quick on flat ground, twitchy near summits.

## climber lion: Sign of the momentum
Moves exactly η along each axis every step, in the direction of a blend of momentum and slope. Every move is diagonal.

## climber anneal: No gradient at all
Tries a random nearby point each step: always takes it if higher, sometimes if lower, less often as it cools. With billions of weights a random move almost never helps, which is why networks use gradients.

## section north: Why Adam cares which way is north
SGD, Momentum and Muon only use the gradient as a whole arrow. Turn the map and the arrow turns with it, so their paths turn too and end on the same hill.

Adam, RMSprop and Lion treat east-west and north-south as separate numbers. Adam divides each one by its own recent size, so early on it moves about η along *each* axis. That makes diagonal steps √2 times longer than straight ones. Rotate the axes and the "diagonals" point somewhere else, so Adam takes a different route. From Hayes Valley, rotating 30° sends Adam to Alamo Square instead of Lafayette Park, and none of the other three move at all.

This matters in real training too. Adam's per-coordinate trick works best when the important directions in a problem line up with individual parameters. The fact-memorizing demo in the next section shows what happens when they don't: with the facts pointing in random directions, Adam's error on rare facts is about five times higher at step 25.

## section muon: Muon was not built for a 2D map
Muon was built for the weight matrices inside neural networks. It takes the momentum matrix and replaces it with the nearest orthogonal matrix using a few Newton-Schulz iterations. That sets every singular value to about 1, so every direction in the update gets the same size.

On this map the position is just two numbers: a 1×2 matrix with one singular value. The whole procedure collapses to "follow the momentum and always step the same distance." On the map, Muon never quite settles on a summit, because its step never shrinks unless you turn on the learning-rate decay.

To see what Muon is actually for, here is a small version of a job it does in a language model: storing facts. A 64×64 matrix has to map 64 keys to 64 values. Facts appear with very different frequencies, like words in text. The most common fact gets 42% of the weight, the rarest 0.08%. Each optimizer starts from zero and uses its own best learning rate.

## template matrix random
At step {step}, error on the rarest half of the facts: SGD {sgd}, Adam {adam}, Muon {muon}.

SGD's learning rate is capped by the most common fact, so rare facts barely move. Muon gives every direction of the update the same size, so rare facts learn about as fast as common ones. Adam's per-number normalization only helps when the facts line up with the axes: there, its rare-fact error at this step is {adam_other}. SGD and Muon give identical results either way.

## template matrix aligned
At step {step}, error on the rarest half of the facts: SGD {sgd}, Adam {adam}, Muon {muon}.

SGD's learning rate is capped by the most common fact, so rare facts barely move. Muon gives every direction of the update the same size, so rare facts learn about as fast as common ones. Adam's per-number normalization works well here because each fact sits on its own axis. With the facts in random directions its rare-fact error at this step is {adam_other}. SGD and Muon give identical results either way.

## section caveat: What a map can't show
A map has two dimensions. A language model has billions, and two things change at that scale.

**True local minima get rare.** At a real local minimum, the loss has to curve upward in every direction at once. With billions of directions that almost never happens. Training slows down mostly at saddle points and long, nearly flat valleys. The "stuck on the wrong hill" story on this page is real in two dimensions and much weaker in a big network.

**The minima found tend to be about equally good.** Different training runs of a large network usually reach very similar loss, a bit like how Twin Peaks and Mount Sutro are only a few feet lower than Mount Davidson. What differs more is how fast they get there and how the solutions behave on new data.

So read the basin maps as intuition for how each update rule moves, not as a prediction of where a real model ends up.

## footer
Elevation from AWS Terrain Tiles, which use bare-earth USGS 3DEP lidar for San Francisco, so buildings are removed. It is resampled to a 20 m grid and smoothed over about 35 m so street cuts and retaining walls don't count as hills. The optimizers climb that smoothed surface, whose tops sit roughly 10 to 40 feet below the summit heights shown.

Summit names, streets, places and addresses © OpenStreetMap contributors. Address search runs entirely in your browser: what you type is never sent anywhere. A climber has arrived when it is within 2.5 m (8 ft) of the top it would reach by walking straight uphill from where it stopped. A flat spot is a top with under 30 cm of prominence. Runs are deterministic and give the same result in every browser; noise uses a fixed seed for each starting point.
