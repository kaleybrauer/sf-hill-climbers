SF Hill Climbers: the words on the page

How this file works:
- Each block starts with a line beginning with two hashes and a space. Keep the part before
  the colon as it is: it tells the page where the text goes. The part after the colon is a
  heading or title, and you can change it.
- Blank lines separate paragraphs. **bold**, *italic* and [links](https://example.com) work.
- In template blocks, words in {curly braces} are filled in by the page with numbers or
  names. Keep those as they are.
- The build checks this file and stops with a message if a block is missing or misnamed, so
  a typo can't break the live site. Short labels (tabs, buttons, legends) are in index.html.

## link preview
Gradient descent, Momentum, Adam and Muon race uphill across San Francisco. Type your address and see which hill each optimizer reaches.

## subtitle
loss = −elevation

## intro
Pick a starting point anywhere in San Francisco! Four optimizers will climb as high as they can. The loss decreases with elevation, so every hilltop is a local minimum and Mount Davidson (928 ft) is the global minimum.

## basins intro
Each patch of color is a basin of attraction: all the starting points from which that optimizer ends on the same hilltop. Darker violet means a higher summit, so a lower loss. At its default learning rate, SGD's map is almost exactly the terrain's own basins, where walking straight uphill in tiny steps would take you, so it makes a good baseline for the others. Hover to compare and click to race from that spot.

## template disagreement
All four agree on {agree} of the city.

On the other {other}, at least one climber ends somewhere else. There are two different endings on {two}, three on {three}, and all four different on {four}.

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
The optimizers end on three different hills, Forest Hill, Larsen Peak and Mount Sutro. Now drag β. At 0.5 they all stop on the same shoulder, and near 0.99 they spread across four different summits.

## card glen: Glen Park BART
Only Momentum carries enough speed over a 400 ft rise, a shallow local minimum, to reach Mount Davidson, the global minimum of the loss.

## card hayes: Hayes Valley
Three optimizers go to Alamo Square. Adam's diagonal steps carry it to Lafayette Park instead.

## card rotate: Hayes Valley, axes rotated 30°
With the axes rotated, Adam now picks Alamo Square along with the other optimizers.

## card ocean: Ocean Beach at Judah
The Sunset is a long, gentle ramp. SGD's steps shrink with the slope, so it needs more than twice as many steps as Adam to reach the top.

## card lion: Swap Adam for Lion
Lion only moves diagonally, a fixed distance per axis. From Ocean Beach it walks across the whole Sunset to Forest Hill.

## card anneal: Swap in simulated annealing
It ignores the slope and sometimes steps downhill on purpose. From Haight & Ashbury it reaches Mount Sutro. Across the city, it reaches a top-four summit 41% of the time.

## card anneal-momentum: Anneal Momentum
Momentum with a huge step (η 256), β 0.95, noise and cosine decay climbs from Dolores Park to the city's highest summits while the others stop on Dolores Heights. With these settings, tuned for this map, it gets there from half of all starts, up from 6%.

## section climbers: The climbers
Each climber is a different optimizer. Each one tries to climb to higher ground after seeing the slope of the ground where it is located, as a two-dimensional gradient g. η is the learning rate.

The default learning rates are sensible picks that are not tuned to make any optimizer win. Where each one ends up depends strongly on η and the other parameters, so try the sliders.

## climber sgd: Plain gradient descent
Steps in proportion to the slope. Steep ground means big strides and flat ground means tiny ones, so it crawls across the Sunset and the Mission.

## climber momentum: Heavy ball
Keeps a running velocity. It speeds up on long slopes, carries through shallow local minima instead of stopping in them, and overshoots before settling.

## climber adam: Per-axis normalized
Divides each axis's step by that axis's recent slope size, so it moves about η per axis per step on steep and flat ground alike. That per-axis treatment is also why it favors diagonals.

## climber muon: Orthogonalized momentum
Normalizes the momentum, then runs a few Newton-Schulz iterations, a cheap way to push every singular value of a matrix toward 1. A 1×2 matrix has only one, so this leaves a fixed step of about 0.7 η along the momentum.

## climber nesterov: Look-ahead momentum
Momentum that adds the current slope on top of the updated velocity, which damps some of the overshoot.

## climber rmsprop: Adam without momentum
Per-axis normalized steps from the current slope. Quick on flat ground, twitchy near summits.

## climber lion: Sign of the momentum
Moves exactly η along each axis every step, in the direction of a blend of momentum and slope. Every move is diagonal.

## climber anneal: No gradient at all
Tries a random nearby point each step. It always takes it if higher and sometimes if lower, less often as it cools. With billions of weights a random move almost never helps, which is why networks use gradients.

## section north: Adam is sensitive to which way is North
SGD, Momentum, Muon and Nesterov only care about the gradient's direction and length. But Adam, RMSprop and Lion treat east-west and north-south as separate numbers.

Adam rescales the east-west and north-south slopes separately, so early on it moves roughly η along *each* axis. That makes diagonal steps √2 times longer than straight ones. If you rotate the axes, the diagonal rotates, so Adam takes a different route. From Hayes Valley, rotating 30° leads Adam to Alamo Square instead of Lafayette Park.

This matters in actual LLM training. Adam's per-coordinate scaling works best when the important directions in a problem line up with individual parameters. This can be seen in the demo below where I trained a single weight matrix to store facts. When the facts are lined up with the axes, Adam does well. When they point in random directions, its error on the rare facts after 25 training steps is about five times higher.

## section muon: Muon was not built for a 2D map
Muon was made for LLM weight matrices, not a 2D map. It takes the momentum matrix and replaces it with roughly the nearest orthogonal matrix using a few Newton-Schulz iterations, bringing every singular value close to 1. This is so every direction gets roughly the same sized update.

On a 2D map, though, the position is just a 1×2 matrix with one singular value. So the optimizer becomes just "follow the direction of the momentum and always step the same distance." On the map, Muon never fully comes to rest on a summit since its step never shrinks unless you turn on learning-rate decay.

To see what Muon is actually for, here is a small demo of a single weight matrix storing facts. I train a 64×64 matrix to map 64 keys to 64 values. The facts appear with very different frequencies — the most common fact appears 42% of the time and the rarest 0.08%. Each optimizer starts from zero and uses its own best learning rate.

[Wang et al. (ICLR 2026)](https://arxiv.org/abs/2509.26030) study this kind of memory and see the same pattern in a real language model, where Muon learns rare facts much better than Adam.

## template matrix random
At step {step}, error on the rarest half of the facts: SGD {sgd}, Adam {adam}, Muon {muon}.

SGD's learning rate is capped by the most common fact, so rare facts barely move. Muon gives every direction of the update the same size, so rare facts learn about as fast as common ones. Adam's per-number normalization only helps when the facts line up with the axes, where its rare-fact error at this step is {adam_other}. SGD and Muon give identical results either way.

## template matrix aligned
At step {step}, error on the rarest half of the facts: SGD {sgd}, Adam {adam}, Muon {muon}.

SGD's learning rate is capped by the most common fact, so rare facts barely move. Muon gives every direction of the update the same size, so rare facts learn about as fast as common ones. Adam's per-number normalization works well here because each fact sits on its own axis. With the facts in random directions its rare-fact error at this step is {adam_other}. SGD and Muon give identical results either way.

## section caveat: What a map can't show
A map only has two dimensions while language models can have billions. So some of what happens on this map doesn't carry over to LLMs. In particular, in much higher dimensions:

**True local minima become rare.** At a real local minimum, the loss has to curve upward in every direction at once. With billions of directions that almost never happens. Training slows down mostly at saddle points and long, nearly flat valleys. The "stuck on the wrong hill" problem on this map is not as common in real training.

**The minima found tend to be about equally good.** Different training runs of a large network usually reach very similar loss, like how Twin Peaks and Mount Sutro are within 16 feet of Mount Davidson. What differs more is how fast they get there and how the solutions behave on new data.


## footer
Elevation from AWS Terrain Tiles, which use bare-earth USGS 3DEP lidar for San Francisco, so buildings are removed. It is resampled to a 20 m grid and smoothed over about 35 m so street cuts and retaining walls don't count as hills. The optimizers climb that smoothed surface, whose tops typically sit 10 to 40 feet below the summit heights shown, and up to about 70 on sharp peaks.

Summit names, streets, places and addresses © OpenStreetMap contributors. Address search runs entirely in your browser, so what you type is never sent anywhere. A climber has arrived when it is within 2.5 m (8 ft) of the top it would reach by walking straight uphill from where it stopped. A flat spot is a top with under 30 cm of prominence. Runs are deterministic and give the same result in every browser; noise uses a fixed seed for each starting point.
