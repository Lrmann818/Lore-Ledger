export function enhanceSelectOnce({
  select,
  Popovers,
  enhanceSelectDropdown,
  preferRight = true,
  buttonClass = "cardSelectBtn",
  optionClass = "swatchOption",
  groupLabelClass = "dropdownGroupLabel",
}) {
  if (!select) return null;
  if (!Popovers) return null;
  if (!enhanceSelectDropdown) return null;
  if (select.dataset.dropdownEnhanced) return null;

  return enhanceSelectDropdown({
    select,
    Popovers,
    buttonClass,
    optionClass,
    groupLabelClass,
    preferRight
  });
}
