function sortForWebsite(watches) {
  watches.sort((a, b) => {
    const aSold = isSoldOrReserved(a);
    const bSold = isSoldOrReserved(b);

    // Available first
    if (aSold !== bSold) {
      return aSold ? 1 : -1;
    }

    // Within Available, keep Airtable row order
    if (!aSold) {
      return (a._airtableEntryOrder || 0) - (b._airtableEntryOrder || 0);
    }

    // Within Sold/Reserved, newest bump date first
    return getBumpTime(b) - getBumpTime(a);
  });

  return watches;
}
