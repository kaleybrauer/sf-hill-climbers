# SF Optimizers

Which San Francisco hill does Adam take you to?

An interactive map that races gradient-based optimizers (SGD, Momentum, Adam, and a 2D reduction of Muon) uphill across San Francisco's real terrain, and shows each optimizer's *territory map*: which hill it reaches from every starting point in the city.

## Idea

- **Loss = −elevation.** SF's hills are the minima; Mt Davidson (928 ft) is the global one, with Twin Peaks and Mt Sutro just behind.
- **Race mode:** drop a pin (say, your apartment) and watch each optimizer climb.
- **Territory mode:** color every starting point by the hill each optimizer ends on. Momentum rolls past small hills and claims bigger territories; plain SGD fragments the city.
- **Rotation test:** rotate the map 30° and Adam's territories shift while SGD's don't (Adam isn't rotation-invariant).

## Plan

1. **Data pipeline (Python):** fetch AWS Terrain Tiles, stitch, crop to SF, smooth lightly, export a ~20 m elevation grid. Sanity-check that Mt Davidson is the high point.
2. **Optimizer core (JS):** hand-written SGD, Momentum, Adam, and Muon-in-2D on a smoothly interpolated terrain; tested on a simple bowl first.
3. **Map view:** shaded relief, contours, hill and neighborhood labels.
4. **Race mode:** animated paths, scoreboard, sliders for learning rate, momentum, and gradient noise.
5. **Territory mode:** per-optimizer territory maps, side by side, with the rotation toggle.
6. **Explanations:** short notes per optimizer, why Muon degenerates in 2D, and why "stuck on the wrong hill" overstates the problem for real high-dimensional networks.
7. **Publish:** single self-contained page, tested at phone and desktop widths.

**Stretch:** a small matrix-shaped toy problem where Muon's real advantage shows up.
