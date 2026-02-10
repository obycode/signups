document.addEventListener("DOMContentLoaded", () => {
  // Handle the delete links
  const deleteLinks = document.querySelectorAll(".delete-link");
  deleteLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();

      const eventId = this.getAttribute("data-event");
      const itemId = this.getAttribute("data-item");
      const url = `/admin/item/delete?event=${eventId}&item=${itemId}`;

      if (
        confirm(
          "Are you sure you want to delete this item? If it already has signups, it will be disabled instead.",
        )
      ) {
        // Redirect to the delete URL
        window.location.href = url;
      }
    });
  });

  // Handle the cancel links
  const cancelLinks = document.querySelectorAll(".cancel-link");
  cancelLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();

      const eventId = this.getAttribute("data-event");
      const signupId = this.getAttribute("data-signup");
      const url = `/admin/signup/delete?event=${eventId}&signup=${signupId}`;

      if (confirm("Are you sure you want to cancel this signup?")) {
        // Redirect to the delete URL
        window.location.href = url;
      }
    });
  });

  // Handle the kid table sorting
  const getCellValue = (tr, idx) =>
    tr.children[idx].innerText || tr.children[idx].textContent;

  const comparer = (idx, asc) => (a, b) =>
    ((v1, v2) =>
      v1 !== "" && v2 !== "" && !isNaN(v1) && !isNaN(v2)
        ? v1 - v2
        : v1.toString().localeCompare(v2))(
      getCellValue(asc ? a : b, idx),
      getCellValue(asc ? b : a, idx),
    );

  document.querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const table = th.closest("table");
      const tbody = table.querySelector("tbody");
      Array.from(tbody.querySelectorAll("tr"))
        .sort(
          comparer(
            Array.from(th.parentNode.children).indexOf(th),
            (this.asc = !this.asc),
          ),
        )
        .forEach((tr) => tbody.appendChild(tr));
    }),
  );

  // Handle the CSV file generation
  document.querySelectorAll(".download-csv").forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();

      const tableId = this.getAttribute("data-table-id");
      const table = document.getElementById(tableId);
      const rows = Array.from(table.querySelectorAll("tr"));
      const csvContent = rows
        .map((row) => {
          const cols = Array.from(row.querySelectorAll("th, td"));
          return cols
            .map((col) => `"${col.innerText.replace(/"/g, '""')}"`)
            .join(",");
        })
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const downloadLink = document.createElement("a");
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = `${tableId}-data.csv`;
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    });
  });

  // Handle toggling hide/show of sections
  document.querySelectorAll(".toggle-section").forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();

      const sectionId = this.getAttribute("data-section-id");
      const section = document.getElementById(sectionId);

      if (section.style.display === "none") {
        section.style.display = "block";
      } else {
        section.style.display = "none";
      }
    });
  });

  // Handle pending edit button click
  const editLinks = document.querySelectorAll(".edit-kid-link");
  editLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      const eventId = this.getAttribute("data-event");
      const kidId = this.getAttribute("data-kid");
      const url = `/admin/kid/edit?event=${eventId}&kid=${kidId}`;
      window.location.href = url;
    });
  });

  // Handle pending kid delete button click
  const deleteKidLinks = document.querySelectorAll(".delete-kid-link");
  deleteKidLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      const eventId = this.getAttribute("data-event");
      const kidId = this.getAttribute("data-kid");
      const url = `/admin/kid/delete?event=${eventId}&kid=${kidId}`;
      if (confirm("Are you sure you want to delete this item?")) {
        window.location.href = url;
      }
    });
  });

  // Handle pending kid approve button click
  const approveKidLinks = document.querySelectorAll(".approve-kid-link");
  approveKidLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      const eventId = this.getAttribute("data-event");
      const kidId = this.getAttribute("data-kid");
      const url = `/admin/kid/approve?event=${eventId}&kid=${kidId}`;
      fetch(url, {
        method: "GET",
        credentials: "same-origin", // Ensures cookies are sent with the request
      })
        .then((response) => {
          if (response.ok) {
            const kidRow = link.closest("tr");

            // Remove the kid from the pending kids table
            const pendingTableBody = document.querySelector(
              "#pending-kids-table tbody",
            );
            pendingTableBody.removeChild(kidRow);

            // Remove the actions column (last td element in the row)
            const actionsCell = kidRow.querySelector("td:last-child");
            if (actionsCell) {
              kidRow.removeChild(actionsCell);
            }

            // Add the kid to the kids table
            const kidsTableBody = document.querySelector("#kids-table tbody");
            kidsTableBody.appendChild(kidRow);

            // Check if there are no more pending kids, and hide the section if necessary
            if (pendingTableBody.children.length === 0) {
              document.querySelector("#pending-kids-section").style.display =
                "none";
            }
          } else {
            console.error("Failed to approve kid.");
          }
        })
        .catch((error) => {
          console.error("Error:", error);
        });
    });
  });

  // Handle bulk pending kid approval
  const approveAllKidsLinks = document.querySelectorAll(
    ".approve-all-kids-link",
  );
  approveAllKidsLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      const eventId = this.getAttribute("data-event");
      const url = `/admin/kid/approve-all?event=${eventId}`;
      if (confirm("Approve all pending kids for this event?")) {
        window.location.href = url;
      }
    });
  });
});
