'use strict';

function bottomRightInWorkArea(workArea = {}, size = {}, gap = 12) {
  const x = Number(workArea.x) || 0;
  const y = Number(workArea.y) || 0;
  const width = Math.max(0, Number(workArea.width) || 0);
  const height = Math.max(0, Number(workArea.height) || 0);
  const windowWidth = Math.max(0, Number(size.width) || 0);
  const windowHeight = Math.max(0, Number(size.height) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  return {
    x: Math.max(x, Math.round(x + width - windowWidth - safeGap)),
    y: Math.max(y, Math.round(y + height - windowHeight - safeGap)),
  };
}

// Resize around the visible cast instead of blindly growing right/down from a
// window's top-left corner.  Width grows around the old centre; height grows
// upward from the old bottom edge.  The result is then clamped into the
// display work area so no newly added project cat can disappear off any edge.
function resizeBoundsInWorkArea(workArea = {}, bounds = {}, size = {}, gap = 4) {
  const areaX = Number(workArea.x) || 0;
  const areaY = Number(workArea.y) || 0;
  const areaWidth = Math.max(0, Number(workArea.width) || 0);
  const areaHeight = Math.max(0, Number(workArea.height) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  const maxWidth = Math.max(1, areaWidth - safeGap * 2);
  const maxHeight = Math.max(1, areaHeight - safeGap * 2);
  const width = Math.min(Math.max(1, Math.round(Number(size.width) || 0)), maxWidth);
  const height = Math.min(Math.max(1, Math.round(Number(size.height) || 0)), maxHeight);
  const previousWidth = Math.max(1, Number(bounds.width) || width);
  const previousHeight = Math.max(1, Number(bounds.height) || height);
  const previousX = Number(bounds.x) || 0;
  const previousY = Number(bounds.y) || 0;
  const desiredX = Math.round(previousX - (width - previousWidth) / 2);
  const desiredY = Math.round(previousY - (height - previousHeight));
  const minX = areaX + safeGap;
  const minY = areaY + safeGap;
  const maxX = Math.max(minX, areaX + areaWidth - width - safeGap);
  const maxY = Math.max(minY, areaY + areaHeight - height - safeGap);
  return {
    x: Math.min(maxX, Math.max(minX, desiredX)),
    y: Math.min(maxY, Math.max(minY, desiredY)),
    width,
    height,
  };
}

module.exports = { bottomRightInWorkArea, resizeBoundsInWorkArea };
