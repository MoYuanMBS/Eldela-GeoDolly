import closeIconUrl from "../../assets/ui/icons/close.svg";
import deleteIconUrl from "../../assets/ui/icons/delete.svg";
import emptyIconUrl from "../../assets/ui/icons/empty.svg";
import extendIconUrl from "../../assets/ui/icons/extend.svg";
import lineToolIconUrl from "../../assets/ui/icons/line-tool.svg";
import lineMeasurementIconUrl from "../../assets/ui/icons/line_measure.svg";
import nodeIconUrl from "../../assets/ui/icons/node.svg";
import polygonIconUrl from "../../assets/ui/icons/polygon.svg";
import polygonMeasurementIconUrl from "../../assets/ui/icons/polygon_measure.svg";
import roundToolIconUrl from "../../assets/ui/icons/round-tool.svg";
import roundMeasurementIconUrl from "../../assets/ui/icons/round_measure.svg";
import tagPopupDotIconUrl from "../../assets/ui/icons/tag-popup-dot.svg";
import tagIconUrl from "../../assets/ui/icons/tag.svg";
import volcanoIconUrl from "../../assets/ui/icons/volcano.svg";
import wayIconUrl from "../../assets/ui/icons/way.svg";
import closeHoverUrl from "../../assets/ui/hover/close-hover.svg";
import closePressedUrl from "../../assets/ui/hover/close-pressed.svg";
import deleteHoverUrl from "../../assets/ui/hover/delete-hover.svg";
import deletePressedUrl from "../../assets/ui/hover/delete-pressed.svg";
import featureHoverUrl from "../../assets/ui/hover/feature.svg";
import measureHoverUrl from "../../assets/ui/hover/measure.svg";
import toolHoverUrl from "../../assets/ui/hover/tool-hover.svg";
import toolPressedUrl from "../../assets/ui/hover/tool-pressed.svg";
import toolSelectUrl from "../../assets/ui/hover/tool-select.svg";
import standardEndBarUrl from "../../assets/ui/bar/stander-end.svg";
import tagEndBarUrl from "../../assets/ui/bar/tag-end.svg";
import toolBottomBarUrl from "../../assets/ui/bar/tool-bottom.svg";
import toolBodyBarUrl from "../../assets/ui/bar/tool-body.svg";
import toolTopBarUrl from "../../assets/ui/bar/tool-top.svg";
import featureBarDividerDecorationUrl from "../../assets/ui/decorations/feature-bar-divider.svg";
import featureBarLeftDecorationUrl from "../../assets/ui/decorations/feature-bar-left.svg";
import featureBarRightDecorationUrl from "../../assets/ui/decorations/feature-bar-right.svg";
import leftDownDecorationUrl from "../../assets/ui/decorations/left-down.svg";
import leftUpDecorationUrl from "../../assets/ui/decorations/left-up.svg";
import popupDecorationUrl from "../../assets/ui/decorations/popup-decoration.svg";
import referenceBarDividerDecorationUrl from "../../assets/ui/decorations/reference-bar-divider.svg";
import rightDownDecorationUrl from "../../assets/ui/decorations/right-down.svg";
import rightUpDecorationUrl from "../../assets/ui/decorations/right-up.svg";
import toolBarDividerDecorationUrl from "../../assets/ui/decorations/tool-bar-divider.svg";

/** UI SVG 只从 assets/ui 导入；icons 固定排在 decorations 之前。 */
export const UI_SVG_ASSETS = {
  icons: {
    close: closeIconUrl,
    delete: deleteIconUrl,
    empty: emptyIconUrl,
    extend: extendIconUrl,
    lineTool: lineToolIconUrl,
    lineMeasurement: lineMeasurementIconUrl,
    node: nodeIconUrl,
    polygon: polygonIconUrl,
    polygonMeasurement: polygonMeasurementIconUrl,
    roundTool: roundToolIconUrl,
    roundMeasurement: roundMeasurementIconUrl,
    tagPopupDot: tagPopupDotIconUrl,
    tag: tagIconUrl,
    volcano: volcanoIconUrl,
    way: wayIconUrl
  },
  hover: {
    closeHover: closeHoverUrl,
    closePressed: closePressedUrl,
    deleteHover: deleteHoverUrl,
    deletePressed: deletePressedUrl,
    feature: featureHoverUrl,
    measure: measureHoverUrl,
    toolHover: toolHoverUrl,
    toolPressed: toolPressedUrl,
    toolSelect: toolSelectUrl
  },
  bar: {
    standardEnd: standardEndBarUrl,
    tagEnd: tagEndBarUrl,
    toolTop: toolTopBarUrl,
    toolBody: toolBodyBarUrl,
    toolBottom: toolBottomBarUrl
  },
  decorations: {
    featureBarDivider: featureBarDividerDecorationUrl,
    featureBarLeft: featureBarLeftDecorationUrl,
    featureBarRight: featureBarRightDecorationUrl,
    leftDown: leftDownDecorationUrl,
    leftUp: leftUpDecorationUrl,
    popup: popupDecorationUrl,
    referenceBarDivider: referenceBarDividerDecorationUrl,
    rightDown: rightDownDecorationUrl,
    rightUp: rightUpDecorationUrl,
    toolBarDivider: toolBarDividerDecorationUrl
  }
} as const;
