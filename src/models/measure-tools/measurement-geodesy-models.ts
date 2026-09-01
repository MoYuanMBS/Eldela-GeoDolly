/** GeographicLib 结算后的纯数值结果；不携带 accumulator 或 Leaflet 对象。 */

export interface PolygonGeodesicMeasurement {
  /** GeographicLib 自动补闭合边后的完整周长，单位为米。 */
  perimeterMeters: number;
  /** 已取绝对值的椭球面积，单位为平方米。 */
  areaSquareMeters: number;
}

export interface CircleGeodesicMeasurement {
  /** 圆心到用户第二次落点的 WGS84 逆解距离。 */
  radiusMeters: number;
  /** 256/512 点采样并经 Richardson 外推后的面积。 */
  areaSquareMeters: number;
}
