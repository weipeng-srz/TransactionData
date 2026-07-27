const robinsonX = [1, .9986, .9954, .99, .9822, .973, .96, .9427, .9216, .8962, .8679, .835, .7986, .7597, .7186, .6732, .6213, .5722, .5322];
const robinsonY = [0, .062, .124, .186, .248, .31, .372, .434, .4958, .5571, .6176, .6769, .7346, .7903, .8435, .8936, .9394, .9761, 1];

// These values exactly match world-map-robinson.svg's viewBox.
const viewBox = { x: -180, y: -91.296, width: 360, height: 182.592 };

export type RobinsonPoint = {
  x: number;
  y: number;
  left: number;
  top: number;
};

export function projectRobinsonPoint(longitude: number, latitude: number): RobinsonPoint {
  const safeLongitude = Math.max(-180, Math.min(180, longitude));
  const safeLatitude = Math.max(-90, Math.min(90, latitude));
  const absoluteLatitude = Math.abs(safeLatitude);
  const index = Math.min(17, Math.floor(absoluteLatitude / 5));
  const fraction = (absoluteLatitude - index * 5) / 5;
  const xCoefficient = robinsonX[index] + (robinsonX[index + 1] - robinsonX[index]) * fraction;
  const yCoefficient = robinsonY[index] + (robinsonY[index + 1] - robinsonY[index]) * fraction;
  const x = safeLongitude * xCoefficient;
  const y = -Math.sign(safeLatitude) * yCoefficient * 91.296;

  return {
    x,
    y,
    left: ((x - viewBox.x) / viewBox.width) * 100,
    top: ((y - viewBox.y) / viewBox.height) * 100,
  };
}
